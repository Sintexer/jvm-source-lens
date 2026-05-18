import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { parseResolutionJson, validateResolutionOutput } from '../resolvers/resolution-output.js';
import {
  canonicalProjectRoot,
  computeProjectRootDigestFull,
  ensureReservedCacheDirs,
  getProjectResolutionCacheDir,
  writeFileAtomicSameDir,
} from './paths.js';

const SKIP_DIR_NAMES = new Set([
  'build',
  '.gradle',
  'node_modules',
  '.git',
  'dist',
  'out',
  'bin',
  '.idea',
  '.vscode',
  'coverage',
  '__pycache__',
  '.svn',
]);

/** Relative paths of Gradle build inputs (SPEC §6.1), sorted, POSIX-style separators. */
export function listBuildInputRelativePaths(projectRoot: string): string[] {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const files: string[] = [];

  for (const name of ['settings.gradle', 'settings.gradle.kts']) {
    if (fs.existsSync(path.join(rootAbs, name))) {
      files.push(name);
    }
  }

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const joined = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) {
          continue;
        }
        walk(joined);
      } else if (ent.isFile()) {
        if (ent.name === 'build.gradle' || ent.name === 'build.gradle.kts') {
          const rel = path.relative(rootAbs, joined);
          files.push(rel.split(path.sep).join('/'));
        }
      }
    }
  }

  walk(rootAbs);

  const toml = path.join(rootAbs, 'gradle', 'libs.versions.toml');
  if (fs.existsSync(toml) && fs.statSync(toml).isFile()) {
    files.push('gradle/libs.versions.toml');
  }

  const lockDir = path.join(rootAbs, 'gradle', 'dependency-locks');
  if (fs.existsSync(lockDir) && fs.statSync(lockDir).isDirectory()) {
    for (const n of fs.readdirSync(lockDir).sort()) {
      if (n.endsWith('.lockfile')) {
        files.push(`gradle/dependency-locks/${n}`);
      }
    }
  }

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

/** SHA-256 (64 lowercase hex) over sorted build-input paths and each file’s content hash. */
export function computeBuildInputsDigest(projectRoot: string): string {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const rels = listBuildInputRelativePaths(rootAbs);
  const lines: string[] = [];
  for (const rel of rels) {
    const full = path.join(rootAbs, rel);
    const buf = fs.readFileSync(full);
    const fileHex = createHash('sha256').update(buf).digest('hex');
    lines.push(`${rel}:${fileHex}`);
  }
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

export type BucketMetaV1 = {
  cacheMetaVersion: 1;
  projectRootAbsolute: string;
  projectRootDigestFull: string;
  writtenAt: string;
};

export type CachedResolutionRead =
  | { ok: true; output: ResolutionOutput }
  | { ok: false; reason: string };

export type WriteCachedResolutionResult = { ok: true } | { ok: false; message: string };

function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function readCachedResolution(projectRoot: string): CachedResolutionRead {
  const canonical = canonicalProjectRoot(projectRoot);
  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, reason: bucketRes.message };
  }
  const bucketDir = bucketRes.dir;
  const hashPath = path.join(bucketDir, 'resolution.hash');
  const jsonPath = path.join(bucketDir, 'resolution.json');

  const storedHash = readTextIfExists(hashPath);
  if (storedHash == null) {
    return { ok: false, reason: 'No resolution.hash in cache bucket' };
  }

  const expectedDigest = computeBuildInputsDigest(canonical);
  const trimmed = storedHash.trim().toLowerCase();
  if (trimmed !== expectedDigest.toLowerCase()) {
    return { ok: false, reason: 'resolution.hash does not match current build inputs' };
  }

  const jsonText = readTextIfExists(jsonPath);
  if (jsonText == null) {
    return { ok: false, reason: 'No resolution.json in cache bucket' };
  }

  let raw: unknown;
  try {
    raw = parseResolutionJson(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Invalid resolution.json: ${msg}` };
  }

  const validated = validateResolutionOutput(raw);
  if (!validated.ok) {
    return { ok: false, reason: validated.message };
  }

  const outRoot = path.resolve(validated.output.projectRoot);
  if (outRoot !== canonical) {
    return {
      ok: false,
      reason: `Cached resolution.projectRoot (${validated.output.projectRoot}) does not match canonical root (${canonical})`,
    };
  }

  return { ok: true, output: validated.output };
}

/**
 * Persists resolution cache files. Writes `resolution.json` first, then `resolution.hash`,
 * then `bucket-meta.json`, each via temp+rename in the bucket directory so concurrent readers
 * are less likely to see a torn combination.
 */
export function writeCachedResolution(
  projectRoot: string,
  output: ResolutionOutput,
  buildInputsDigest: string,
): WriteCachedResolutionResult {
  const canonical = canonicalProjectRoot(projectRoot);
  const reserved = ensureReservedCacheDirs();
  if (!reserved.ok) {
    return { ok: false, message: reserved.message };
  }

  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, message: bucketRes.message };
  }
  const bucketDir = bucketRes.dir;
  fs.mkdirSync(bucketDir, { recursive: true });

  const meta: BucketMetaV1 = {
    cacheMetaVersion: 1,
    projectRootAbsolute: canonical,
    projectRootDigestFull: computeProjectRootDigestFull(canonical),
    writtenAt: new Date().toISOString(),
  };

  try {
    writeFileAtomicSameDir(path.join(bucketDir, 'resolution.json'), `${JSON.stringify(output)}\n`);
    writeFileAtomicSameDir(path.join(bucketDir, 'resolution.hash'), `${buildInputsDigest.toLowerCase()}\n`);
    writeFileAtomicSameDir(path.join(bucketDir, 'bucket-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to write resolution cache: ${msg}` };
  }

  return { ok: true };
}
