import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { access, constants } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getClassSource } from '../../src/get-class-source.js';
import { resolveWithResolutionCache } from '../../src/resolve-with-cache.js';
import { searchClasses } from '../../src/search-classes.js';

/**
 * Integration smoke: `test/fixtures/gradle-smoke` (multimodule Gradle project).
 * `gradle-wrapper.jar` is not committed — run `bun run ensure:gradle-smoke-wrapper` (or CI)
 * before tests. Override path with `JVMSRC_GRADLE_SMOKE_ROOT` if needed.
 */
const repoRoot = path.resolve(import.meta.dir, '../..');
const envRaw = process.env.JVMSRC_GRADLE_SMOKE_ROOT?.trim();
const fixtureRoot = envRaw
  ? path.isAbsolute(envRaw)
    ? envRaw
    : path.resolve(repoRoot, envRaw)
  : path.join(repoRoot, 'test/fixtures/gradle-smoke');

async function gradleSmokeRunnable(root: string): Promise<boolean> {
  try {
    await access(root, constants.F_OK);
  } catch {
    return false;
  }
  const gw = path.join(root, 'gradlew');
  try {
    await access(gw, constants.F_OK);
  } catch {
    return false;
  }
  const jar = path.join(root, 'gradle/wrapper/gradle-wrapper.jar');
  try {
    await access(jar, constants.F_OK);
  } catch {
    return false;
  }
  if (process.platform !== 'win32') {
    try {
      await access(gw, constants.X_OK);
    } catch {
      return false;
    }
  }
  const launcher = process.platform === 'win32' ? path.join(root, 'gradlew.bat') : gw;
  const proc = Bun.spawn([launcher, '-v'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  return (await proc.exited) === 0;
}

const runnable = await gradleSmokeRunnable(fixtureRoot);

describe.skipIf(!runnable)('Gradle smoke fixture', () => {
  let prevCache: string | undefined;
  let tmpCache: string;

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-gradle-smoke-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
  });

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    try {
      fs.rmSync(tmpCache, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('resolveWithResolutionCache + getClassSource for interproject Core', async () => {
    const resolved = await resolveWithResolutionCache(fixtureRoot, {
      forceRefresh: true,
      diagnosticOperation: 'gradle_smoke',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }

    const got = await getClassSource('com.smoke.Core', {
      projectRoot: fixtureRoot,
      modulePath: ':app',
    });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.source).toContain('public class Core');
    expect(got.sourceAvailable).toBe(true);
    expect(got.provenance.kind).toBe('interproject');

    const search = await searchClasses({
      projectRoot: fixtureRoot,
      query: 'com.smoke.Core',
      modulePath: ':app',
      limit: 20,
    });
    expect(search.ok).toBe(true);
    if (search.ok) {
      expect(search.totalMatches).toBeGreaterThanOrEqual(1);
      expect(search.hits.some((h) => h.className === 'com.smoke.Core')).toBe(true);
    }
  });
});
