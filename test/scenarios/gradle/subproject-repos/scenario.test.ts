import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getClassSource } from '../../../../src/get-class-source.js';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';

setDefaultTimeout(180_000);

/**
 * Real-Gradle scenario: repositories are declared only in the submodule `:service`; the root project has none.
 * Regressions covered:
 *  - `jvmsrcResolveSources` queried only the root project's repositories, so the sources jar was never
 *    found and every class was decompiled (`sourceAvailable: false`).
 *  - Gradle wrote `.gradle/` and `build/reports/problems/` into the scanned project.
 *
 * The local Maven repo (`../repo`, gitignored) is built at test time with javac + jar; no binary is committed.
 *
 * Requires the wrapper JAR from scripts/ensure-scenario-wrappers.sh. Silently skipped when absent.
 */

const scenarioRoot = path.resolve(import.meta.dir);
const appRoot = path.join(scenarioRoot, 'app');
const repoDir = path.join(scenarioRoot, 'repo');
const scenarioReady = fs.existsSync(path.join(appRoot, 'gradle/wrapper/gradle-wrapper.jar'));

const MARKER = 'only present in the sources jar';

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(' ')} exited with code ${code}`);
  }
}

if (scenarioReady) {
  beforeAll(async () => {
    // Stale state from older runs would hide a regression of the "no project writes" check.
    for (const stale of ['.gradle', 'build', 'service/build']) {
      fs.rmSync(path.join(appRoot, stale), { recursive: true, force: true });
    }
    fs.rmSync(repoDir, { recursive: true, force: true });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-subrepos-'));
    const srcDir = path.join(work, 'src/acme/greeter');
    const classesDir = path.join(work, 'classes');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });
    const javaFile = path.join(srcDir, 'Greeter.java');
    fs.writeFileSync(
      javaFile,
      `package acme.greeter;\n\n/** ${MARKER}. */\npublic class Greeter {\n  public String greet(String name) { return "hello " + name; }\n}\n`,
    );
    await run(['javac', '-d', classesDir, javaFile], work);
    const out = path.join(repoDir, 'acme/greeter/1.0.0');
    fs.mkdirSync(out, { recursive: true });
    await run(['jar', 'cf', path.join(out, 'greeter-1.0.0.jar'), '-C', classesDir, '.'], work);
    await run(['jar', 'cf', path.join(out, 'greeter-1.0.0-sources.jar'), '-C', path.join(work, 'src'), '.'], work);
    fs.writeFileSync(
      path.join(out, 'greeter-1.0.0.pom'),
      '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>' +
        '<groupId>acme</groupId><artifactId>greeter</artifactId><version>1.0.0</version></project>\n',
    );
    fs.rmSync(work, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });
}

describe.skipIf(!scenarioReady)('gradle/subproject-repos scenario (real Gradle)', () => {
  let prevCache: string | undefined;
  let tmpCache: string;

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-subrepos-cache-'));
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

  test('shouldReturnOriginalSourceWhenOnlyASubmoduleDeclaresRepositories', async () => {
    const got = await getClassSource('acme.greeter.Greeter', { projectRoot: appRoot, modulePath: ':service' });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(true);
    expect(got.source).toContain(MARKER);
  });

  test('shouldNotWriteIntoTheProjectTreeWhenResolving', async () => {
    const resolved = await resolveWithResolutionCache(appRoot, { forceRefresh: true });
    expect(resolved.ok).toBe(true);
    await getClassSource('acme.greeter.Greeter', { projectRoot: appRoot, modulePath: ':service' });

    expect(fs.existsSync(path.join(appRoot, '.gradle'))).toBe(false);
    expect(fs.existsSync(path.join(appRoot, 'build'))).toBe(false);
    expect(fs.existsSync(path.join(appRoot, 'service/build'))).toBe(false);
  });
});
