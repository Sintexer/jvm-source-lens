import { opendir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { listFqnsFromJarClassEntries } from './class-search/jar-class-fqns.js';
import { isPackageName, packageNameFromSource } from './class-search/source-package.js';
import { scanKotlinDeclarations } from './class-structure/kotlin/kotlin-declarations.js';
import { skipLexicalNoise, typeKeywordAt } from './class-structure/parse-java-type-metadata.js';
import { isClasspathBinaryJarArtifact, type ClassSourceError } from './extractor/class-source-types.js';
import { checkJarSize } from './extractor/jar-size-guard.js';
import { inferIncludeTest } from './extractor/match-module.js';
import { pickResolvedConfiguration, type PickClasspathOptions } from './extractor/pick-classpath.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import type { ArtifactCoordinates, ResolutionOutput, ResolveSourcesJarResult } from './resolvers/base.js';
import { resolverById } from './resolvers/index.js';
import { truncatePlainText } from './text-format/truncate.js';

type Scope = PickClasspathOptions & { packageName: string };
export type GetPackageDocsInput = Scope & { projectRoot: string; forceRefresh?: boolean };
export type PackageOwner = {
  provenance: { kind: 'interproject'; moduleName: string; moduleRoot: string; coordinates: ArtifactCoordinates }
    | { kind: 'external' | 'local-file'; jarPath: string; sourcesJarPath: string | null; coordinates: ArtifactCoordinates };
  description: string | null;
  /** Relative to moduleRoot on disk, or an entry in sourcesJarPath. */
  docsPath: string | null;
  types: { name: string; summary: string | null }[];
};
type ErrorDetail = ClassSourceError | { code: 'DOCS_NOT_FOUND' | 'DOCS_RESOLVE_FAILED'; message: string };
export type GetPackageDocsResult = { ok: true; packageName: string; owners: PackageOwner[] } | { ok: false; error: ErrorDetail };

const ENTRY_BYTES = 512 * 1024;
const OWNER_BYTES = 8 * 1024 * 1024;
const MAX_TYPES = 256;
const MAX_OWNERS = 16;
const sourceFile = /^(?:package\.html|package-info\.java|[\w$-]+\.(?:java|kt|groovy|scala))$/;
const invalid = { ok: false, error: { code: 'INVALID_FQN', message: 'Expected a dotted package name.' } } as const;
const valid = (name: string) => name.length <= 512 && isPackageName(name);

function prose(raw: string, limit: number): string | null {
  const text = raw.replace(/<!--[^]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<\/?[a-z][^<>]*>/gi, ' ').replace(/\{@(?:link(?:plain)?|code|literal)\s+([^}]+)\}/g, '$1')
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (_, k: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" })[k]!)
    .replace(/\s+/g, ' ').trim();
  return text ? truncatePlainText(text, limit) : null;
}

function addType(owner: PackageOwner, name: string, summary: string | null) {
  if (name.length > 256) throw Error('Package type name exceeds 256 characters.');
  const existing = owner.types.find(t => t.name === name);
  if (existing) { existing.summary ??= summary; return; }
  if (owner.types.length >= MAX_TYPES) throw Error(`Package exceeds ${MAX_TYPES} types per owner.`);
  owner.types.push({ name, summary });
}

/** Only top-level declarations in the requested package may contribute prose. */
function consume(owner: PackageOwner, packageName: string, file: string, path: string, text: string) {
  const setDoc = (s: string | null) => {
    if (s && (!owner.description || (file === 'package-info.java' && owner.docsPath?.endsWith('package.html')))) {
      owner.description = s;
      owner.docsPath = path;
    }
  };
  if (file === 'package.html') {
    const body = /<body\b[^>]*>([^]*?)(?:<\/body\s*>|$)/i.exec(text)?.[1] ?? text;
    setDoc(prose(body, 4096));
    return;
  }
  if (packageNameFromSource(text) !== packageName) return;
  const type = (name: string, doc: string | null) => {
    if (owner.provenance.kind === 'interproject' || owner.types.some(t => t.name === name)) {
      addType(owner, name, doc && prose(doc, 240));
    }
  };
  if (file.endsWith('.kt')) {
    for (const d of scanKotlinDeclarations(text, 0, text.length)) {
      if (['class', 'interface', 'object'].includes(d.keyword) && d.name) type(d.name, d.kdoc);
    }
    return;
  }
  let depth = 0, parens = 0, doc: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const end = skipLexicalNoise(text, i);
    if (end !== i) {
      if (!depth && !parens && text.startsWith('/**', i)) {
        doc = text.slice(i + 3, end - 2).replace(/^\s*\* ?/gm, '').split(/^\s*@\w/m, 1)[0]!.trim();
      }
      i = end - 1;
      continue;
    }
    const ch = text[i];
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (parens) continue;
    else if (ch === '{') { depth++; doc = null; }
    else if (ch === '}') { depth--; doc = null; }
    else if (depth) continue;
    else if (ch === ';') doc = null;
    else if (file === 'package-info.java' && text.startsWith('package', i) && /^package\s/.test(text.slice(i, i + 8))) {
      setDoc(doc && prose(doc, 4096));
      return;
    } else {
      const hit = typeKeywordAt(text, i);
      if (hit) { type(hit.name, doc); doc = null; i = hit.end - 1; }
    }
  }
}

function checkBudget(size: number, total: number) {
  if (size > ENTRY_BYTES || total > OWNER_BYTES) throw Error('Package source exceeds per-entry or per-owner read limit.');
}

async function readModule(owner: PackageOwner, packageName: string, includeTest: boolean): Promise<boolean> {
  if (owner.provenance.kind !== 'interproject') return false;
  const root = owner.provenance.moduleRoot;
  const pkgPath = packageName.replaceAll('.', '/');
  let total = 0, count = 0, hasDocsFile = false;
  for (const scope of includeTest ? ['main', 'test'] : ['main']) {
    for (const lang of ['java', 'kotlin', 'groovy', 'scala']) {
      const dir = join(root, 'src', scope, lang, pkgPath);
      let canonical: string;
      try { canonical = await realpath(dir); } catch (e) {
        if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) continue;
        throw e;
      }
      const rel = relative(await realpath(root), canonical);
      if (rel === '..' || rel.startsWith('..' + sep)) continue;
      for await (const entry of await opendir(canonical)) {
        if (!entry.isFile() || !sourceFile.test(entry.name)) continue;
        if (++count > 512) throw Error('Package exceeds 512 source files per owner.');
        const path = join(canonical, entry.name);
        const size = (await stat(path)).size;
        checkBudget(size, total += size);
        const text = await readFile(path, 'utf8');
        consume(owner, packageName, entry.name, relative(root, join(dir, entry.name)), text);
        hasDocsFile ||= entry.name === 'package.html' || (entry.name === 'package-info.java' && packageNameFromSource(text) === packageName);
      }
    }
  }
  return hasDocsFile || owner.types.length > 0;
}

async function readArchive(owner: PackageOwner, packageName: string, path: string) {
  const size = checkJarSize(path);
  if (!size.ok) throw Error(size.message);
  const prefix = packageName.replaceAll('.', '/') + '/';
  let total = 0, count = 0;
  const files = unzipSync(await readFile(path), { filter: e => {
    if (!e.name.startsWith(prefix) || !sourceFile.test(e.name.slice(prefix.length))) return false;
    if (++count > 512) throw Error('Package exceeds 512 source files per owner.');
    const bytes = Math.max(e.originalSize, e.compression === 0 ? e.size : 0);
    checkBudget(bytes, total += bytes);
    return true;
  } });
  for (const [name, bytes] of Object.entries(files)) {
    consume(owner, packageName, name.slice(prefix.length), name, new TextDecoder().decode(bytes));
  }
}

/** Resolution-independent entry point; probing never fetches source or merges module versions. */
export async function lookupPackageDocs(output: ResolutionOutput, opts: Scope,
  fetchSources?: (c: ArtifactCoordinates) => Promise<ResolveSourcesJarResult>): Promise<GetPackageDocsResult> {
  const { packageName } = opts;
  if (!valid(packageName)) return invalid;
  const includeTest = inferIncludeTest(opts.modulePath, opts.includeTest);
  const pick = (modulePath?: string) => pickResolvedConfiguration(output, { ...opts, modulePath, includeTest });
  const first = pick(opts.modulePath);
  let scopes = [first];
  if (!first.ok) {
    if (first.error.code !== 'MODULE_AMBIGUOUS') return first;
    scopes = first.error.modulePaths.map(pick);
  }
  const modules: string[] = [];
  let owners: PackageOwner[] = [];
  const binary = new Map<string, string[]>();
  const local = new Map<string, PackageOwner | null>();
  try {
    for (const scope of scopes) {
      if (!scope.ok) return scope;
      const found: PackageOwner[] = [];
      const seen = new Set<string>();
      const inspectModule = async (moduleName: string, moduleRoot: string, coordinates: ArtifactCoordinates) => {
        if (seen.has(moduleRoot)) return;
        seen.add(moduleRoot);
        const provenance = { kind: 'interproject' as const, moduleName, moduleRoot, coordinates };
        if (!local.has(moduleRoot)) {
          const owner: PackageOwner = { provenance, description: null, docsPath: null, types: [] };
          local.set(moduleRoot, await readModule(owner, packageName, !!includeTest) ? owner : null);
        }
        const match = local.get(moduleRoot);
        if (match) found.push({ ...match, provenance });
      };
      await inspectModule(scope.module.name, scope.module.path, { group: 'project', name: scope.module.name, version: null });
      for (const a of scope.configuration.artifacts) {
        const { group, name, version } = a;
        const coordinates = { group, name, version };
        if (a.origin === 'interproject' && a.interproject) {
          await inspectModule(a.interproject.moduleName, a.interproject.modulePath, coordinates);
        } else if (a.origin !== 'interproject' && a.jarPath && isClasspathBinaryJarArtifact(a) && !seen.has(a.jarPath)) {
          seen.add(a.jarPath);
          let names = binary.get(a.jarPath);
          if (!names) {
            const listed = listFqnsFromJarClassEntries(a.jarPath, { packageName });
            if (!listed.ok) return { ok: false, error: { code: 'ZIP_READ_ERROR', jarPath: a.jarPath, message: listed.message } };
            names = listed.fqns.map(n => n.slice(packageName.length + 1))
              .filter(n => n === 'package-info' || (!n.includes('.') && isPackageName(n)));
            binary.set(a.jarPath, names);
          }
          if (names.length) {
            const owner: PackageOwner = { provenance: { kind: a.origin, coordinates, jarPath: a.jarPath, sourcesJarPath: a.sourcesJarPath ?? null },
              description: null, docsPath: null, types: [] };
            for (const n of names) if (n !== 'package-info') addType(owner, n, null);
            found.push(owner);
          }
        }
        if (found.length > MAX_OWNERS) throw Error(`Package exceeds ${MAX_OWNERS} owners.`);
      }
      if (found.length) { modules.push(scope.module.name); owners = found; }
    }
    if (!modules.length) return { ok: false, error: { code: 'DOCS_NOT_FOUND', message: `No owner of package ${packageName} on the selected classpath.` } };
    if (modules.length > 1) return { ok: false, error: { code: 'MODULE_AMBIGUOUS', modulePaths: modules,
      message: `Package ${packageName} occurs on several modules' classpaths; retry with modulePath.` } };
    for (const owner of owners) {
      const p = owner.provenance;
      if (p.kind !== 'interproject') {
        if (!p.sourcesJarPath && p.kind === 'external' && fetchSources) {
          const resolved = await fetchSources(p.coordinates);
          if (!resolved.ok) return { ok: false, error: { code: 'DOCS_RESOLVE_FAILED', message: truncatePlainText(resolved.message, 2048) } };
          p.sourcesJarPath = resolved.sourcesJarPath;
        }
        if (p.sourcesJarPath) {
          try { await readArchive(owner, packageName, p.sourcesJarPath); } catch (e) {
            return { ok: false, error: { code: 'ZIP_READ_ERROR', jarPath: p.sourcesJarPath, message: String(e) } };
          }
        }
      }
      owner.types.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (Buffer.byteLength(JSON.stringify(owners)) > 64 * 1024) throw Error('Package result exceeds 64 KiB.');
    return { ok: true, packageName, owners };
  } catch (e) {
    return { ok: false, error: { code: 'DOCS_RESOLVE_FAILED', message: truncatePlainText(String(e), 2048) } };
  }
}

export async function getPackageDocs(input: GetPackageDocsInput): Promise<GetPackageDocsResult> {
  if (!valid(input.packageName)) return invalid;
  const resolved = await resolveWithResolutionCache(input.projectRoot, { forceRefresh: input.forceRefresh, diagnosticOperation: 'get_package_docs' });
  if (!resolved.ok) return { ok: false, error: { code: 'RESOLUTION_FAILED', message: truncatePlainText(resolved.message, 2048) } };
  const resolver = resolverById(resolved.output.buildSystem.type);
  return lookupPackageDocs(resolved.output, input, resolver && (c => resolver.resolveSourcesJar(resolved.output.projectRoot, c)));
}
