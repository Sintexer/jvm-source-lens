import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DependencyResolver, ResolutionResult } from '../resolvers/base.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import {
  computeBuildInputsDigest,
  listBuildInputRelativePaths,
  readCachedResolution,
  writeCachedResolution,
} from './index.js';
import {
  canonicalProjectRoot,
  computeProjectRootDigestFull,
  getProjectBucketId,
  getProjectResolutionCacheDir,
  resolveGlobalCacheRoot,
} from './paths.js';

let prevJvmsrcCacheRoot: string | undefined;
let testCacheRoot: string;

function isolateCacheEnv(): void {
  testCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cache-root-'));
  prevJvmsrcCacheRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = testCacheRoot;
}

function restoreCacheEnv(): void {
  if (prevJvmsrcCacheRoot === undefined) {
    delete process.env.JVMSRC_CACHE_ROOT;
  } else {
    process.env.JVMSRC_CACHE_ROOT = prevJvmsrcCacheRoot;
  }
  try {
    fs.rmSync(testCacheRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function globalCachePath(): string {
  const r = resolveGlobalCacheRoot();
  if (!r.ok) {
    throw new Error(r.message);
  }
  return r.path;
}

function bucketDirFor(projectRoot: string): string {
  const r = getProjectResolutionCacheDir(projectRoot);
  if (!r.ok) {
    throw new Error(r.message);
  }
  return r.dir;
}

function writeGradleStubs(projectDir: string): void {
  fs.mkdirSync(path.join(projectDir, 'gradle', 'dependency-locks'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'settings.gradle'), 'rootProject.name = "t"\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'build.gradle'), 'plugins { id("java") }\n', 'utf8');
}

function minimalResolutionOutput(projectRoot: string): ResolutionOutput {
  return {
    schemaVersion: '1.0',
    resolvedAt: '2026-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: false },
    projectRoot: canonicalProjectRoot(projectRoot),
    modules: [],
    errors: [],
  };
}

describe('cache paths', () => {
  beforeEach(() => {
    isolateCacheEnv();
  });
  afterEach(() => {
    restoreCacheEnv();
  });

  test('getProjectBucketId is stable 8-char hex prefix of full digest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-proj-'));
    const full = computeProjectRootDigestFull(dir);
    const id = getProjectBucketId(dir);
    expect(id.length).toBe(8);
    expect(full.startsWith(id)).toBe(true);
    expect(bucketDirFor(dir)).toBe(path.join(globalCachePath(), 'projects', id));
  });

  test('two different project paths get different bucket ids', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-b-'));
    expect(getProjectBucketId(a)).not.toBe(getProjectBucketId(b));
  });
});

describe('computeBuildInputsDigest', () => {
  test('lists expected inputs and digest changes when build.gradle changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-input-'));
    writeGradleStubs(dir);
    const rels = listBuildInputRelativePaths(dir);
    expect(rels).toContain('settings.gradle');
    expect(rels).toContain('build.gradle');
    const d1 = computeBuildInputsDigest(dir);
    fs.appendFileSync(path.join(dir, 'build.gradle'), '\n// x\n', 'utf8');
    const d2 = computeBuildInputsDigest(dir);
    expect(d1).not.toBe(d2);
    expect(d1.length).toBe(64);
    expect(d2.length).toBe(64);
  });
});

describe('JVMSRC_CACHE_ROOT validation', () => {
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = saved;
    }
  });

  test('rejects relative path with structured errors', () => {
    saved = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = 'relative/cache';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-relproj-'));
    writeGradleStubs(dir);

    const read = readCachedResolution(dir);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toContain('JVMSRC_CACHE_ROOT');
      expect(read.reason).toContain('absolute');
    }

    const digest = computeBuildInputsDigest(dir);
    const write = writeCachedResolution(dir, minimalResolutionOutput(dir), digest);
    expect(write.ok).toBe(false);
    if (!write.ok) {
      expect(write.message).toContain('JVMSRC_CACHE_ROOT');
    }
  });
});

describe('resolution cache read/write', () => {
  beforeEach(() => {
    isolateCacheEnv();
  });
  afterEach(() => {
    restoreCacheEnv();
  });

  test('readCachedResolution misses when bucket empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-empty-'));
    writeGradleStubs(dir);
    const r = readCachedResolution(dir);
    expect(r.ok).toBe(false);
  });

  test('write then read hits when build files unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-rw-'));
    writeGradleStubs(dir);
    const out = minimalResolutionOutput(dir);
    const digest = computeBuildInputsDigest(dir);
    const w = writeCachedResolution(dir, out, digest);
    expect(w.ok).toBe(true);
    const r = readCachedResolution(dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.projectRoot).toBe(canonicalProjectRoot(dir));
    }
    expect(fs.existsSync(path.join(globalCachePath(), 'decompiled'))).toBe(true);
  });

  test('read misses after build.gradle changes (hash mismatch)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-inv-'));
    writeGradleStubs(dir);
    const digest = computeBuildInputsDigest(dir);
    const w = writeCachedResolution(dir, minimalResolutionOutput(dir), digest);
    expect(w.ok).toBe(true);
    fs.appendFileSync(path.join(dir, 'build.gradle'), '\n', 'utf8');
    const r = readCachedResolution(dir);
    expect(r.ok).toBe(false);
  });
});

describe('resolveWithResolutionCache', () => {
  beforeEach(() => {
    isolateCacheEnv();
  });
  afterEach(() => {
    restoreCacheEnv();
  });

  test('forceRefresh skips cache and re-invokes resolver', async () => {
    const { resolveWithResolutionCache } = await import('../resolve-with-cache.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-fr-'));
    writeGradleStubs(dir);
    const out = minimalResolutionOutput(dir);
    const digest = computeBuildInputsDigest(dir);
    const wr = writeCachedResolution(dir, out, digest);
    expect(wr.ok).toBe(true);

    let calls = 0;
    const resolver: DependencyResolver = {
      detect: () => true,
      resolve: async (): Promise<ResolutionResult> => {
        calls++;
        return { ok: true, output: out };
      },
    };

    const first = await resolveWithResolutionCache(dir, { resolver });
    expect(first.ok).toBe(true);
    expect(calls).toBe(0);

    await resolveWithResolutionCache(dir, { forceRefresh: true, resolver });
    expect(calls).toBe(1);

    await resolveWithResolutionCache(dir, { forceRefresh: true, resolver });
    expect(calls).toBe(2);
  });

  test('forwards resolveOptions to resolver.resolve', async () => {
    const { resolveWithResolutionCache } = await import('../resolve-with-cache.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-ropts-'));
    writeGradleStubs(dir);
    const out = minimalResolutionOutput(dir);
    let seen: unknown;
    const resolver: DependencyResolver = {
      detect: () => true,
      resolve: async (_root, opts): Promise<ResolutionResult> => {
        seen = opts;
        return { ok: true, output: out };
      },
    };
    await resolveWithResolutionCache(dir, {
      forceRefresh: true,
      resolver,
      resolveOptions: { inheritGradleStderr: true, onBeforeGradle: () => {} },
    });
    expect(seen).toEqual(
      expect.objectContaining({
        inheritGradleStderr: true,
        onBeforeGradle: expect.any(Function),
      }),
    );
  });
});
