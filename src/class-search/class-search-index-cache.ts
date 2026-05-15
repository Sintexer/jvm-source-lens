import fs from 'node:fs';
import path from 'node:path';
import { canonicalProjectRoot, getProjectResolutionCacheDir, writeFileAtomicSameDir } from '../cache/paths.js';
import {
  CLASS_SEARCH_INDEX_FORMAT_VERSION,
  type ClassSearchIndexFileV1,
  type ClassSearchIndexMeta,
} from './types.js';

const INDEX_FILE = 'class-search-index.json';

export type ReadClassSearchIndexResult =
  | { ok: true; file: ClassSearchIndexFileV1 }
  | { ok: false; reason: 'missing' | 'invalid' | 'bucket'; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseIndexFile(raw: unknown): ClassSearchIndexFileV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  const meta = raw.meta;
  const entries = raw.entries;
  if (!isRecord(meta) || !Array.isArray(entries)) {
    return null;
  }
  if (meta.indexFormatVersion !== CLASS_SEARCH_INDEX_FORMAT_VERSION) {
    return null;
  }
  if (
    typeof meta.buildInputsDigest !== 'string' ||
    typeof meta.resolutionFingerprint !== 'string' ||
    typeof meta.moduleName !== 'string' ||
    typeof meta.configurationName !== 'string' ||
    typeof meta.includeTest !== 'boolean' ||
    typeof meta.builtAt !== 'string' ||
    typeof meta.entryCount !== 'number' ||
    typeof meta.skippedArtifacts !== 'number'
  ) {
    return null;
  }
  const parsedEntries: ClassSearchIndexFileV1['entries'] = [];
  for (const e of entries) {
    if (!isRecord(e)) {
      return null;
    }
    if (
      typeof e.className !== 'string' ||
      typeof e.simpleName !== 'string' ||
      typeof e.searchText !== 'string' ||
      (e.origin !== 'external' && e.origin !== 'interproject') ||
      typeof e.group !== 'string' ||
      typeof e.name !== 'string' ||
      (e.version !== null && typeof e.version !== 'string') ||
      typeof e.resolvedModuleName !== 'string' ||
      typeof e.configurationName !== 'string' ||
      (e.jarPath !== null && typeof e.jarPath !== 'string') ||
      (e.moduleRoot !== null && typeof e.moduleRoot !== 'string') ||
      (e.interprojectModuleName !== null && typeof e.interprojectModuleName !== 'string')
    ) {
      return null;
    }
    parsedEntries.push({
      className: e.className,
      simpleName: e.simpleName,
      searchText: e.searchText,
      origin: e.origin,
      group: e.group,
      name: e.name,
      version: e.version as string | null,
      resolvedModuleName: e.resolvedModuleName,
      configurationName: e.configurationName,
      jarPath: e.jarPath as string | null,
      moduleRoot: e.moduleRoot as string | null,
      interprojectModuleName: e.interprojectModuleName as string | null,
    });
  }
  return {
    meta: meta as ClassSearchIndexMeta,
    entries: parsedEntries,
  };
}

export function readClassSearchIndex(projectRoot: string): ReadClassSearchIndexResult {
  const canonical = canonicalProjectRoot(projectRoot);
  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, reason: 'bucket', message: bucketRes.message };
  }
  const p = path.join(bucketRes.dir, INDEX_FILE);
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    return { ok: false, reason: 'missing', message: 'No class search index file' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'invalid', message: `Invalid JSON: ${msg}` };
  }
  const file = parseIndexFile(raw);
  if (file === null) {
    return { ok: false, reason: 'invalid', message: 'Unrecognized class search index shape' };
  }
  return { ok: true, file };
}

export function writeClassSearchIndex(projectRoot: string, file: ClassSearchIndexFileV1): { ok: true } | { ok: false; message: string } {
  const canonical = canonicalProjectRoot(projectRoot);
  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, message: bucketRes.message };
  }
  const dir = bucketRes.dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to ensure cache dir: ${msg}` };
  }
  const dest = path.join(dir, INDEX_FILE);
  try {
    writeFileAtomicSameDir(dest, `${JSON.stringify(file)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to write class search index: ${msg}` };
  }
  return { ok: true };
}
