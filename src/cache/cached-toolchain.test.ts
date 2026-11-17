import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { computeBuildInputsDigest, readCachedResolution, writeCachedResolution } from './index.js';
import { canonicalProjectRoot } from './paths.js';
import { readCachedJavaToolchainVersion } from './cached-toolchain.js';

describe('readCachedJavaToolchainVersion', () => {
  let prevCacheRoot: string | undefined;
  let cacheRoot: string;
  let projectDir: string;

  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-tc-cache-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-tc-proj-'));
    prevCacheRoot = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = cacheRoot;
    fs.writeFileSync(path.join(projectDir, 'build.gradle'), 'plugins { id("java") }\n', 'utf8');
  });

  afterEach(() => {
    if (prevCacheRoot === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCacheRoot;
    }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('shouldReturnUndefinedWhenCacheBucketIsEmpty', () => {
    expect(readCachedJavaToolchainVersion(projectDir)).toBeUndefined();
  });

  test('shouldReturnJavaToolchainVersionEvenAfterBuildScriptEditInvalidatesHash', () => {
    const out: ResolutionOutput = {
      schemaVersion: '1.2',
      resolvedAt: '2026-11-17T00:00:00Z',
      buildSystem: { type: 'gradle', version: '8.8', wrapper: false },
      projectRoot: canonicalProjectRoot(projectDir),
      modules: [],
      errors: [],
      javaToolchainVersion: 21,
    };
    const digest = computeBuildInputsDigest(projectDir);
    expect(writeCachedResolution(projectDir, out, digest).ok).toBe(true);

    // Edit build.gradle so readCachedResolution misses, simulating re-resolution or forceRefresh.
    fs.appendFileSync(path.join(projectDir, 'build.gradle'), '// changed\n', 'utf8');
    expect(readCachedResolution(projectDir).ok).toBe(false);

    expect(readCachedJavaToolchainVersion(projectDir)).toBe(21);
  });

  test('shouldReturnUndefinedWhenToolchainAbsentOrNonPositive', () => {
    const out: ResolutionOutput = {
      schemaVersion: '1.2',
      resolvedAt: '2026-11-17T00:00:00Z',
      buildSystem: { type: 'gradle', version: '8.8', wrapper: false },
      projectRoot: canonicalProjectRoot(projectDir),
      modules: [],
      errors: [],
    };
    const digest = computeBuildInputsDigest(projectDir);
    expect(writeCachedResolution(projectDir, out, digest).ok).toBe(true);
    expect(readCachedJavaToolchainVersion(projectDir)).toBeUndefined();
  });
});
