import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import envPaths from 'env-paths';

const APP_NAME = 'jvmsrc';

export type GlobalCacheRootResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export type ProjectCacheDirResult =
  | { ok: true; dir: string }
  | { ok: false; message: string };

/** Canonical absolute project root for cache keys and validation. */
export function canonicalProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

/**
 * Resolves the global cache root: `env-paths` default for `jvmsrc`, or **`JVMSRC_CACHE_ROOT`**.
 * If the env var is set, it must be a **non-empty absolute** path (relative values are rejected).
 */
export function resolveGlobalCacheRoot(): GlobalCacheRootResult {
  const raw = process.env.JVMSRC_CACHE_ROOT;
  const override = raw?.trim();
  if (override) {
    if (!path.isAbsolute(override)) {
      return {
        ok: false,
        message:
          'JVMSRC_CACHE_ROOT must be set to an absolute path; relative paths are not allowed (they would depend on the process working directory).',
      };
    }
    return { ok: true, path: path.normalize(override) };
  }
  return { ok: true, path: envPaths(APP_NAME, { suffix: '' }).cache };
}

/** Full SHA-256 (64 lowercase hex) of UTF-8 canonical absolute project path. */
export function computeProjectRootDigestFull(projectRoot: string): string {
  const abs = canonicalProjectRoot(projectRoot);
  return createHash('sha256').update(abs, 'utf8').digest('hex');
}

/** First 8 hex chars of `computeProjectRootDigestFull` — per-bucket directory name under `projects/`. */
export function getProjectBucketId(projectRoot: string): string {
  return computeProjectRootDigestFull(projectRoot).slice(0, 8);
}

/** Directory for one project’s resolution cache files. */
export function getProjectResolutionCacheDir(projectRoot: string): ProjectCacheDirResult {
  const root = resolveGlobalCacheRoot();
  if (!root.ok) {
    return { ok: false, message: root.message };
  }
  return {
    ok: true,
    dir: path.join(root.path, 'projects', getProjectBucketId(projectRoot)),
  };
}

/**
 * Creates `projects/` and reserved `decompiled/` under the global cache root.
 * `gc.json` is reserved for a future GC slice and is not written here.
 */
export function ensureReservedCacheDirs(): GlobalCacheRootResult {
  const root = resolveGlobalCacheRoot();
  if (!root.ok) {
    return root;
  }
  fs.mkdirSync(path.join(root.path, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(root.path, 'decompiled'), { recursive: true });
  return root;
}

function makeAtomicTempName(dir: string, finalBaseName: string): string {
  const token = randomBytes(8).toString('hex');
  return path.join(dir, `.${finalBaseName}.${process.pid}.${token}.tmp`);
}

/**
 * Writes `body` to `destPath` atomically (temp in same directory + rename).
 * Reduces torn reads if another process reads `resolution.json` while a write is in progress.
 */
export function writeFileAtomicSameDir(destPath: string, body: string): void {
  const dir = path.dirname(destPath);
  const base = path.basename(destPath);
  const tmp = makeAtomicTempName(dir, base);
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    fs.renameSync(tmp, destPath);
  } catch (first) {
    if (process.platform === 'win32' && fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
      fs.renameSync(tmp, destPath);
    } else {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw first;
    }
  }
}
