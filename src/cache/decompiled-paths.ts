import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactCoordinates } from '../extractor/class-source-types.js';
import { ensureReservedCacheDirs, resolveGlobalCacheRoot, writeFileAtomicSameDir } from './paths.js';

export type DecompiledCachePathResult =
  | { ok: true; cachePath: string }
  | { ok: false; message: string };

const SIMPLE_CLASS_NAME = /^[a-zA-Z_$][\w$]*$/;

/** Makes a Maven coordinate segment safe as a single path component. */
export function sanitizeCacheSegment(segment: string): string {
  return segment.replace(/[/\\\0]/g, '_');
}

export type ValidateCacheSegmentResult = { ok: true; segment: string } | { ok: false; message: string };

/**
 * Validates a coordinate segment for use under `decompiled/`.
 * Rejects empty, `.`, `..`, and segments containing `..`.
 */
export function validateCacheSegment(label: string, raw: string): ValidateCacheSegmentResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: `Invalid cache ${label}: empty segment` };
  }
  if (trimmed === '.' || trimmed === '..') {
    return { ok: false, message: `Invalid cache ${label}: ${JSON.stringify(raw)}` };
  }
  if (trimmed.includes('..')) {
    return { ok: false, message: `Invalid cache ${label}: segment must not contain ".."` };
  }
  const segment = sanitizeCacheSegment(trimmed);
  if (segment.length === 0) {
    return { ok: false, message: `Invalid cache ${label}: empty after sanitization` };
  }
  if (segment === '.' || segment === '..') {
    return { ok: false, message: `Invalid cache ${label}: ${JSON.stringify(raw)}` };
  }
  return { ok: true, segment };
}

function simpleClassNameFromFqn(className: string): string {
  const lastDot = className.lastIndexOf('.');
  return lastDot === -1 ? className : className.slice(lastDot + 1);
}

function decompiledFileName(className: string): { ok: true; fileName: string } | { ok: false; message: string } {
  const simple = simpleClassNameFromFqn(className);
  if (!SIMPLE_CLASS_NAME.test(simple)) {
    return {
      ok: false,
      message: `Invalid class name for decompile cache file: ${JSON.stringify(className)}`,
    };
  }
  return { ok: true, fileName: `${simple}.java` };
}

/** Resolved absolute path to the shared `decompiled/` directory under the global cache root. */
export function getDecompiledCacheRoot(): DecompiledCachePathResult {
  const ensured = ensureReservedCacheDirs();
  if (!ensured.ok) {
    return { ok: false, message: ensured.message };
  }
  const root = resolveGlobalCacheRoot();
  if (!root.ok) {
    return { ok: false, message: root.message };
  }
  return { ok: true, cachePath: path.join(root.path, 'decompiled') };
}

/** True when `filePath` resolves to a path under the global `decompiled/` directory. */
export function isPathWithinDecompiledCache(filePath: string): boolean {
  const decompiledRoot = getDecompiledCacheRoot();
  if (!decompiledRoot.ok) {
    return false;
  }
  const resolvedRoot = path.resolve(decompiledRoot.cachePath);
  const resolvedFile = path.resolve(filePath);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(prefix);
}

/**
 * Path under global cache: `decompiled/<group>/<artifact>/<version>/<SimpleName>.java`.
 * Verifies the result stays confined under `decompiled/`.
 */
export function getDecompiledCacheFilePath(
  coordinates: ArtifactCoordinates,
  className: string,
): DecompiledCachePathResult {
  const decompiledRoot = getDecompiledCacheRoot();
  if (!decompiledRoot.ok) {
    return decompiledRoot;
  }

  const group = validateCacheSegment('group', coordinates.group);
  if (!group.ok) {
    return group;
  }
  const name = validateCacheSegment('artifact', coordinates.name);
  if (!name.ok) {
    return name;
  }
  const versionRaw = coordinates.version ?? 'unknown';
  const version = validateCacheSegment('version', versionRaw);
  if (!version.ok) {
    return version;
  }

  const fileName = decompiledFileName(className);
  if (!fileName.ok) {
    return fileName;
  }

  const cachePath = path.join(
    decompiledRoot.cachePath,
    group.segment,
    name.segment,
    version.segment,
    fileName.fileName,
  );

  if (!isPathWithinDecompiledCache(cachePath)) {
    return { ok: false, message: 'Decompile cache path escapes decompiled/ root' };
  }

  return { ok: true, cachePath };
}

/** Returns cached decompiled source, or `null` if missing, empty, or path is not confined. */
export function readDecompiledCacheFile(filePath: string): string | null {
  if (!isPathWithinDecompiledCache(filePath)) {
    return null;
  }
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function writeDecompiledCacheFile(filePath: string, source: string): void {
  if (!isPathWithinDecompiledCache(filePath)) {
    throw new Error('Refusing to write outside decompiled/ cache root');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomicSameDir(filePath, source);
}
