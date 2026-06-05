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
  fs.mkdirSync(path.join(projectDir, 'gradle', 'wrapper'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'settings.gradle'), 'rootProject.name = "t"\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'build.gradle'), 'plugins { id("java") }\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    'distributionUrl=https://services.gradle.org/distributions/gradle-8.0-bin.zip\n', 'utf8');
}

function minimalResolutionOutput(projectRoot: string): ResolutionOutput {
  return {
    schemaVersion: '1.1',
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

  test('gradle.properties is tracked and digest changes when it changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-gp-'));
    writeGradleStubs(dir);
    fs.writeFileSync(path.join(dir, 'gradle.properties'), 'myLibVersion=1.0.0\n', 'utf8');

    const rels = listBuildInputRelativePaths(dir);
    expect(rels).toContain('gradle.properties');

    const d1 = computeBuildInputsDigest(dir);
    fs.writeFileSync(path.join(dir, 'gradle.properties'), 'myLibVersion=2.0.0\n', 'utf8');
    const d2 = computeBuildInputsDigest(dir);
    expect(d1).not.toBe(d2);
  });

  test('gradle/wrapper/gradle-wrapper.properties is tracked and digest changes when Gradle version changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-gwp-'));
    writeGradleStubs(dir);

    const rels = listBuildInputRelativePaths(dir);
    expect(rels).toContain('gradle/wrapper/gradle-wrapper.properties');

    const d1 = computeBuildInputsDigest(dir);
    fs.writeFileSync(
      path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl=https://services.gradle.org/distributions/gradle-9.0-bin.zip\n',
      'utf8',
    );
    const d2 = computeBuildInputsDigest(dir);
    expect(d1).not.toBe(d2);
  });

  test('digest changes when GRADLE_USER_HOME env var changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-guh-'));
    writeGradleStubs(dir);

    const savedGuh = process.env.GRADLE_USER_HOME;
    try {
      process.env.GRADLE_USER_HOME = '/tmp/fake-gradle-home-a';
      const d1 = computeBuildInputsDigest(dir);

      process.env.GRADLE_USER_HOME = '/tmp/fake-gradle-home-b';
      const d2 = computeBuildInputsDigest(dir);

      expect(d1).not.toBe(d2);
    } finally {
      if (savedGuh === undefined) {
        delete process.env.GRADLE_USER_HOME;
      } else {
        process.env.GRADLE_USER_HOME = savedGuh;
      }
    }
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

  test('read misses after gradle.properties changes (hash mismatch)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-gp-inv-'));
    writeGradleStubs(dir);
    fs.writeFileSync(path.join(dir, 'gradle.properties'), 'myLibVersion=1.0.0\n', 'utf8');
    const digest = computeBuildInputsDigest(dir);
    const w = writeCachedResolution(dir, minimalResolutionOutput(dir), digest);
    expect(w.ok).toBe(true);
    // Bump the version — cache must miss even without touching build.gradle.
    fs.writeFileSync(path.join(dir, 'gradle.properties'), 'myLibVersion=2.0.0\n', 'utf8');
    const r = readCachedResolution(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('build inputs');
    }
  });

  test('read misses when GRADLE_USER_HOME changes between write and read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-guh-inv-'));
    writeGradleStubs(dir);
    const savedGuh = process.env.GRADLE_USER_HOME;
    try {
      process.env.GRADLE_USER_HOME = '/tmp/fake-gradle-home-write';
      const digest = computeBuildInputsDigest(dir);
      const w = writeCachedResolution(dir, minimalResolutionOutput(dir), digest);
      expect(w.ok).toBe(true);

      process.env.GRADLE_USER_HOME = '/tmp/fake-gradle-home-read';
      const r = readCachedResolution(dir);
      expect(r.ok).toBe(false);
    } finally {
      if (savedGuh === undefined) {
        delete process.env.GRADLE_USER_HOME;
      } else {
        process.env.GRADLE_USER_HOME = savedGuh;
      }
    }
  });

  test('read misses when a local (non-Gradle-managed) artifact jar content changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-localart-'));
    const jarPath = path.join(dir, 'local-repo', 'lib-1.0.0.jar');
    fs.mkdirSync(path.dirname(jarPath), { recursive: true });
    fs.writeFileSync(jarPath, 'fake jar v1');
    writeGradleStubs(dir);

    const out: ResolutionOutput = {
      ...minimalResolutionOutput(dir),
      modules: [
        {
          name: ':app',
          path: dir,
          configurations: [
            {
              name: 'compileClasspath',
              scope: 'compile',
              artifacts: [
                {
                  group: 'com.example',
                  name: 'lib',
                  version: '1.0.0',
                  type: 'jar',
                  jarPath,
                  sourcesJarPath: null,
                  origin: 'external',
                  direct: true,
                },
              ],
            },
          ],
        },
      ],
    };

    const digest = computeBuildInputsDigest(dir);
    const w = writeCachedResolution(dir, out, digest);
    expect(w.ok).toBe(true);

    // Cache hit — nothing changed.
    const r1 = readCachedResolution(dir);
    expect(r1.ok).toBe(true);

    // Republish: overwrite the jar with new content (same path, different bytes).
    fs.writeFileSync(jarPath, 'fake jar v2 with new method');

    // Must miss because local-artifact.hash no longer matches.
    const r2 = readCachedResolution(dir);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toContain('local-artifact');
    }
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
