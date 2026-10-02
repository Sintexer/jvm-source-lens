import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getClassSource } from '../../../../src/get-class-source.js';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';

setDefaultTimeout(180_000);

/**
 * Real-Gradle scenario: a flatDir jar (`implementation name: 'feedos_client_api'`) has no Maven group
 * or version and no sources jar, so `get_class_source` must fall back to CFR decompilation.
 * Regression: the decompile cache rejected the empty group ("Invalid cache group: empty segment").
 *
 * The jar is built at test time (javac + jar) into `app/libs/` (gitignored); no binary is committed.
 *
 * Requires the wrapper JAR from scripts/ensure-scenario-wrappers.sh. Silently skipped when absent.
 */

const appRoot = path.join(path.resolve(import.meta.dir), 'app');
const libsDir = path.join(appRoot, 'libs');
const scenarioReady = fs.existsSync(path.join(appRoot, 'gradle/wrapper/gradle-wrapper.jar'));

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(' ')} exited with code ${code}`);
  }
}

let buildDir = '';

if (scenarioReady) {
  beforeAll(async () => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-flatdir-'));
    const srcDir = path.join(buildDir, 'src/com/feedos/api');
    const classesDir = path.join(buildDir, 'classes');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });
    fs.mkdirSync(libsDir, { recursive: true });
    const javaFile = path.join(srcDir, 'QuotationTradeEventExt.java');
    fs.writeFileSync(
      javaFile,
      'package com.feedos.api;\npublic class QuotationTradeEventExt {\n  public int tradeVolume() { return 42; }\n}\n',
    );
    await run(['javac', '-d', classesDir, javaFile], buildDir);
    await run(['jar', 'cf', path.join(libsDir, 'feedos_client_api.jar'), '-C', classesDir, '.'], buildDir);
  });

  afterAll(() => {
    fs.rmSync(libsDir, { recursive: true, force: true });
    fs.rmSync(buildDir, { recursive: true, force: true });
  });
}

describe.skipIf(!scenarioReady)('gradle/flatdir-jar scenario (real Gradle)', () => {
  let prevCache: string | undefined;
  let tmpCache: string;

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-flatdir-cache-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
  });

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    fs.rmSync(tmpCache, { recursive: true, force: true });
  });

  test('decompiles a class from a flatDir jar with no coordinates and no sources', async () => {
    const resolved = await resolveWithResolutionCache(appRoot, { forceRefresh: true });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const got = await getClassSource('com.feedos.api.QuotationTradeEventExt', { projectRoot: appRoot });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(false);
    expect(got.source).toContain('tradeVolume');
  });
});
