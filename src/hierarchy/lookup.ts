import { statSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectResolutionCacheDir } from '../cache/paths.js';
import { isClasspathBinaryJarArtifact, type ClassSourceError } from '../extractor/class-source-types.js';
import { canonicalizeClassName, normalizeClassNameSyntax } from '../extractor/canonicalize-class-name.js';
import { fqnToZipRelPaths } from '../extractor/fqn-paths.js';
import { inferIncludeTest } from '../extractor/match-module.js';
import { pickResolvedConfiguration, type PickClasspathOptions } from '../extractor/pick-classpath.js';
import { resolveWithResolutionCache } from '../resolve-with-cache.js';
import type { ArtifactCoordinates, ResolutionOutput } from '../resolvers/resolution-output.js';
import { binaryHeaders } from './binary-index.js';
import type { HierarchyNode } from './scan.js';

type Scope = PickClasspathOptions & { typeName: string; directOnly?: boolean; forceRefresh?: boolean };
export type HierarchyInput = Scope & { projectRoot: string };
type Owner = { origin: 'workspace' | 'interproject' | 'external' | 'local-file'; coordinates: ArtifactCoordinates;
  moduleName?: string; moduleRoot?: string; jarPath?: string };
export type HierarchyGroup = Owner & { classes: Array<{ className: string; direct: boolean }> };
type Kind = 'implementors' | 'subclasses';
type Success = { ok: true; className: string; kind: Kind; modulePath: string; configuration: string;
  groups: HierarchyGroup[]; totalMatches: number; limit: number; truncated: boolean; limitations: string[] };
type AmbiguousTarget = { code: 'HIERARCHY_TARGET_AMBIGUOUS'; message: string; className: string; modulePath: string };
export type HierarchyResult = Success | { ok: false; error: ClassSourceError | AmbiguousTarget; diagnosticId?: string; hint?: string };
const LIMIT = 200;
const COVERAGE = 'Binary headers only: source-only types, custom output directories, JDK classes and multi-release JAR overlays are not indexed. Missing intermediate binaries can hide indirect matches.';

type Definitions = Map<string, { node: HierarchyNode; owner: Owner }>;

function targetKind(defs: Definitions, name: string): Kind | 'ambiguous' | undefined {
  const target = defs.get(name);
  if (target) return target.node.isInterface ? 'implementors' : 'subclasses';
  let superclass = false, iface = false;
  for (const { node } of defs.values()) {
    superclass ||= !node.isInterface && node.superclass === name;
    iface ||= node.interfaces.includes(name);
    if (superclass && iface) return 'ambiguous';
  }
  return superclass ? 'subclasses' : iface ? 'implementors' : undefined;
}

/** Build reverse edges only after choosing the first visible definition of each name. */
function descendants(defs: Definitions, opts: Scope, kind: Kind) {
  const edges = new Map<string, string[]>();
  const direct = new Set<string>();
  const edge = (parent: string, child: string, viaInterface: boolean) => {
    if (kind === 'subclasses' && viaInterface) return;
    if (parent === opts.typeName && (kind === 'subclasses' || viaInterface)) direct.add(child);
    const children = edges.get(parent);
    if (children) children.push(child);
    else edges.set(parent, [child]);
  };
  for (const { node } of defs.values()) {
    if (node.superclass && !node.isInterface) edge(node.superclass, node.name, false);
    for (const iface of node.interfaces) edge(iface, node.name, true);
  }
  const queue = [...direct];
  const visited = new Set([opts.typeName]);
  const names: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i]!;
    if (visited.has(name)) continue;
    visited.add(name);
    if (!defs.get(name)!.node.isInterface) names.push(name);
    if (!opts.directOnly) for (const child of edges.get(name) ?? []) queue.push(child);
  }
  const groups = new Map<Owner, HierarchyGroup>();
  for (const className of names.sort().slice(0, LIMIT)) {
    const { owner } = defs.get(className)!;
    const group = groups.get(owner) ?? { ...owner, classes: [] };
    group.classes.push({ className, direct: direct.has(className) });
    groups.set(owner, group);
  }
  return { groups: [...groups.values()], totalMatches: names.length };
}

export function lookupHierarchy(output: ResolutionOutput, opts: Scope): HierarchyResult {
  const className = opts.typeName;
  const valid = fqnToZipRelPaths(className);
  if (!valid.ok) return valid;
  const includeTest = inferIncludeTest(opts.modulePath, opts.includeTest);
  const pick = (modulePath?: string) => pickResolvedConfiguration(output, { ...opts, modulePath, includeTest });
  const first = pick(opts.modulePath);
  let scopes = [first];
  if (!first.ok) {
    if (first.error.code !== 'MODULE_AMBIGUOUS') return first;
    scopes = first.error.modulePaths.map(pick);
  }
  const bucket = getProjectResolutionCacheDir(output.projectRoot);
  if (!bucket.ok) return { ok: false, error: { code: 'RESOLUTION_FAILED', message: bucket.message } };
  const memo = new Map<string, HierarchyNode[]>();
  const candidates: Array<Success | { ok: false; error: AmbiguousTarget }> = [];
  let searchedArtifactCount = 0;
  try {
    for (const scope of scopes) {
      if (!scope.ok) return scope;
      const { module, configuration } = scope;
      const defs: Definitions = new Map();
      const limitations = [COVERAGE];
      const visit = (path: string, directory: boolean, owner: Owner) => {
        let nodes = memo.get(path);
        if (!nodes) {
          nodes = binaryHeaders(bucket.dir, path, directory, !!opts.forceRefresh);
          memo.set(path, nodes);
        }
        for (const node of nodes) if (!defs.has(node.name)) defs.set(node.name, { node, owner });
      };
      const visitModule = (owner: Owner, test: boolean) => {
        const sets = test ? ['test', 'main'] : ['main'];
        let found = false;
        for (const set of sets) {
          const dirs = output.buildSystem.type === 'maven' ? [set === 'main' ? 'target/classes' : 'target/test-classes'] :
            ['java', 'kotlin', 'scala', 'groovy'].map(lang => `build/classes/${lang}/${set}`).concat(`build/classes/kotlin/jvm/${set}`);
          for (const suffix of dirs) {
            const dir = join(owner.moduleRoot!, suffix);
            if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
            visit(dir, true, owner);
            found = true;
          }
        }
        if (!found) limitations.push(`No standard compiled output found for ${owner.moduleName}.`);
      };
      visitModule({ origin: 'workspace', moduleName: module.name, moduleRoot: module.path,
        coordinates: { group: 'project', name: module.name, version: null } }, configuration.scope.startsWith('test-'));
      searchedArtifactCount += configuration.artifacts.length;
      for (const a of configuration.artifacts) {
        const coordinates = { group: a.group, name: a.name, version: a.version };
        if (a.origin === 'interproject' && a.interproject) {
          visitModule({ origin: a.origin, coordinates, moduleName: a.interproject.moduleName, moduleRoot: a.interproject.modulePath }, false);
        } else if (a.jarPath && isClasspathBinaryJarArtifact(a)) {
          try { visit(a.jarPath, false, { origin: a.origin, coordinates, jarPath: a.jarPath }); }
          catch (e) { return { ok: false, error: { code: 'ZIP_READ_ERROR', jarPath: a.jarPath, message: String(e) } }; }
        }
      }
      for (const error of output.errors) if (error.module === module.name && (!error.configuration || error.configuration === configuration.name)) limitations.push(error.message);
      const kind = targetKind(defs, className);
      if (!kind) continue;
      if (kind === 'ambiguous') {
        candidates.push({ ok: false, error: { code: 'HIERARCHY_TARGET_AMBIGUOUS', className, modulePath: module.name,
          message: `${module.name} references ${className} as both a superclass and an interface without a visible definition. Retry with a modulePath or configuration that resolves the target.` } });
        continue;
      }
      if (kind === 'implementors') limitations.push('Only implementing classes are returned; subinterfaces are traversed but not listed.');
      const { groups, totalMatches } = descendants(defs, opts, kind);
      candidates.push({ ok: true, className, kind, modulePath: module.name,
        configuration: configuration.name, groups, totalMatches, limit: LIMIT, truncated: totalMatches > LIMIT, limitations });
    }
  } catch (e) { return { ok: false, error: { code: 'RESOLUTION_FAILED', message: String(e) } }; }
  if (candidates.length > 1) return { ok: false, error: { code: 'MODULE_AMBIGUOUS', className,
    modulePaths: candidates.map(c => c.ok ? c.modulePath : c.error.modulePath), message: `${className} occurs on multiple classpaths; retry with modulePath.` } };
  return candidates[0] ?? { ok: false, error: { code: 'CLASS_NOT_FOUND', className, searchedArtifactCount,
    message: `No definition of or reference to ${className} in the selected binaries. ${COVERAGE}` } };
}

export async function getHierarchy(input: HierarchyInput): Promise<HierarchyResult> {
  let className = normalizeClassNameSyntax(input.typeName);
  const valid = fqnToZipRelPaths(className);
  if (!valid.ok) return valid;
  const result = await resolveWithResolutionCache(input.projectRoot, { forceRefresh: input.forceRefresh,
    diagnosticOperation: 'find_subtypes' });
  if (!result.ok) return { ok: false, diagnosticId: result.diagnosticId, hint: result.hint,
    error: { code: 'RESOLUTION_FAILED', message: result.message, stderr: result.stderr } };
  // A qualified binary name needs no additional classpath probe.
  if (!className.includes('.') || /(?:^|\.)[A-Z][^.]*\./.test(className)) {
    const canonical = canonicalizeClassName(input.projectRoot, result.output, className, {
      ...input, includeTest: inferIncludeTest(input.modulePath, input.includeTest),
    });
    if (!canonical.ok) return canonical;
    className = canonical.className;
  }
  return lookupHierarchy(result.output, { ...input, typeName: className });
}
