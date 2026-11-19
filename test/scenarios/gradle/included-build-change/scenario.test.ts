import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';

setDefaultTimeout(180_000);

/**
 * Real-Gradle scenario: the jar name comes from a plugin in the included build `../picker` (outside the project root).
 * Editing it must change the build-input digest, so the next resolve re-runs Gradle without `forceRefresh`.
 *
 * `app/libs/liba.jar` and `app/libs/libb.jar` are built at test time (gitignored).
 * Requires the wrapper JAR from scripts/ensure-scenario-wrappers.sh. Silently skipped when absent.
 */

const scenarioRoot = path.resolve(import.meta.dir);
const appRoot = path.join(scenarioRoot, 'app');
const libsDir = path.join(appRoot, 'libs');
const editedFile = path.join(scenarioRoot, 'picker/src/main/java/example/PickerPlugin.java');
const scenarioReady = fs.existsSync(path.join(appRoot, 'gradle/wrapper/gradle-wrapper.jar'));

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(' ')} exited with code ${code}`);
  }
}

async function buildJar(workDir: string, name: string, className: string): Promise<void> {
  const srcDir = path.join(workDir, name, 'src/demo');
  const classesDir = path.join(workDir, name, 'classes');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(classesDir, { recursive: true });
  const javaFile = path.join(srcDir, `${className}.java`);
  fs.writeFileSync(javaFile, `package demo;\npublic class ${className} {}\n`);
  await run(['javac', '-d', classesDir, javaFile], workDir);
  await run(['jar', 'cf', path.join(libsDir, `${name}.jar`), '-C', classesDir, '.'], workDir);
}

function jarNames(output: { modules: { configurations: { artifacts: { jarPath: string }[] }[] }[] }): string[] {
  return output.modules
    .flatMap((m) => m.configurations)
    .flatMap((c) => c.artifacts)
    .map((a) => path.basename(a.jarPath));
}

let workDir = '';
let originalEdited = '';

if (scenarioReady) {
  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-included-build-change-'));
    fs.mkdirSync(libsDir, { recursive: true });
    await buildJar(workDir, 'liba', 'LibA');
    await buildJar(workDir, 'libb', 'LibB');
    originalEdited = fs.readFileSync(editedFile, 'utf8');
  });

  afterAll(() => {
    fs.writeFileSync(editedFile, originalEdited, 'utf8');
    fs.rmSync(libsDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });
}

describe.skipIf(!scenarioReady)('gradle/included-build-change scenario (real Gradle)', () => {
  let prevCache: string | undefined;
  let tmpCache: string;

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-included-build-change-cache-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
    fs.writeFileSync(editedFile, originalEdited, 'utf8');
  });

  afterEach(() => {
    fs.writeFileSync(editedFile, originalEdited, 'utf8');
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    fs.rmSync(tmpCache, { recursive: true, force: true });
  });

  test('shouldReResolveWithoutForceRefreshWhenEditedSourceSwitchesJar', async () => {
    const r1 = await resolveWithResolutionCache(appRoot, { forceRefresh: true });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(jarNames(r1.output)).toContain('liba.jar');

    fs.writeFileSync(editedFile, originalEdited.replace('"liba"', '"libb"'), 'utf8');

    const r2 = await resolveWithResolutionCache(appRoot, { forceRefresh: false });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(jarNames(r2.output)).toContain('libb.jar');
    expect(jarNames(r2.output)).not.toContain('liba.jar');
  });

  test('shouldHitCacheWhenNothingChanged', async () => {
    const r1 = await resolveWithResolutionCache(appRoot, { forceRefresh: true });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = await resolveWithResolutionCache(appRoot, { forceRefresh: false });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.output.resolvedAt).toBe(r1.output.resolvedAt);
  });
});
