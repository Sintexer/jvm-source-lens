import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { computeBuildInputsDigest, writeCachedResolution } from '../../cache/index.js';
import { canonicalProjectRoot } from '../../cache/paths.js';
import { DEFAULT_GRADLE_TIMEOUT_MS, gradleIsolationArgs, gradleTimeoutMs, runGradleTask } from './spawn-gradle.js';

describe('gradleTimeoutMs', () => {
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    } else {
      process.env.JVMSRC_GRADLE_TIMEOUT_MS = saved;
    }
  });

  test('defaults to DEFAULT_GRADLE_TIMEOUT_MS', () => {
    saved = process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    delete process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    expect(gradleTimeoutMs()).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
  });

  test('parses positive JVMSRC_GRADLE_TIMEOUT_MS', () => {
    saved = process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    process.env.JVMSRC_GRADLE_TIMEOUT_MS = '12345';
    expect(gradleTimeoutMs()).toBe(12345);
  });

  test('invalid env falls back to default', () => {
    saved = process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    process.env.JVMSRC_GRADLE_TIMEOUT_MS = '0';
    expect(gradleTimeoutMs()).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
  });
});

describe('runGradleTask cached toolchain wiring', () => {
  test('reads persisted javaToolchainVersion from cache bucket when cachedToolchainVersion is omitted', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-spawn-tc-'));
    const cacheDir = path.join(tmp, 'cache');
    const projDir = path.join(tmp, 'proj');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'build.gradle'), 'plugins { id("java") }\n', 'utf8');

    const prevCache = process.env.JVMSRC_CACHE_ROOT;
    const prevJavaHome = process.env.JVMSRC_JAVA_HOME;
    process.env.JVMSRC_CACHE_ROOT = cacheDir;
    delete process.env.JVMSRC_JAVA_HOME;
    try {
      const canonical = canonicalProjectRoot(projDir);
      writeCachedResolution(
        canonical,
        {
          schemaVersion: '1.2',
          resolvedAt: '2026-11-17T00:00:00Z',
          buildSystem: { type: 'gradle', version: '8.8', wrapper: false },
          projectRoot: canonical,
          modules: [],
          errors: [],
          javaToolchainVersion: 99,
        },
        computeBuildInputsDigest(canonical),
      );
      // Simulate build edit so hash no longer matches, then invoke runGradleTask without explicit hint.
      fs.appendFileSync(path.join(projDir, 'build.gradle'), '// bump\n', 'utf8');

      const res = await runGradleTask(canonical, 'jvmsrcResolve');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toContain('Java 99');
        expect(res.message).toContain('previously resolved Gradle toolchain version');
      }
    } finally {
      if (prevCache === undefined) {
        delete process.env.JVMSRC_CACHE_ROOT;
      } else {
        process.env.JVMSRC_CACHE_ROOT = prevCache;
      }
      if (prevJavaHome !== undefined) {
        process.env.JVMSRC_JAVA_HOME = prevJavaHome;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('gradleIsolationArgs', () => {
  test('shouldKeepGradleProjectStateOutsideProjectTreeWhenCacheRootIsSet', () => {
    const prev = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = '/tmp/jvmsrc-iso-cache';
    try {
      const result = gradleIsolationArgs('/work/proj');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const dir = result.args[result.args.indexOf('--project-cache-dir') + 1]!;
      expect(dir.startsWith('/tmp/jvmsrc-iso-cache/projects/')).toBe(true);
      expect(dir.endsWith('gradle-project-cache')).toBe(true);
      expect(result.args).toContain('-Dorg.gradle.problems.report=false');
    } finally {
      if (prev === undefined) delete process.env.JVMSRC_CACHE_ROOT;
      else process.env.JVMSRC_CACHE_ROOT = prev;
    }
  });

  test('shouldFailWhenCacheRootIsRelative', () => {
    const prev = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = 'relative/cache';
    try {
      expect(gradleIsolationArgs('/work/proj').ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.JVMSRC_CACHE_ROOT;
      else process.env.JVMSRC_CACHE_ROOT = prev;
    }
  });
});
