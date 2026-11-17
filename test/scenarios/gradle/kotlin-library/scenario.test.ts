import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getClassSource } from '../../../../src/get-class-source.js';
import { getClassStructure } from '../../../../src/get-class-structure.js';
import { getMethodSignatures } from '../../../../src/get-method-signatures.js';

setDefaultTimeout(180_000);

/**
 * Real-Gradle scenario: a Kotlin library published with a sources JAR, used from a Java project.
 *
 * `producer/` publishes `com.example:kt-lib:1.0.0` (a class and a top-level function, which
 * Kotlin compiles into the `GreetKt` facade) to a temp Maven repo. `consumer/` depends on it.
 * The tests check that `get` returns the original `.kt` text instead of CFR output.
 *
 * Skipped when a wrapper JAR is absent (`bun run ensure:scenario-wrappers`).
 */

const scenarioRoot = path.resolve(import.meta.dir);
const producerRoot = path.join(scenarioRoot, 'producer');
const consumerRoot = path.join(scenarioRoot, 'consumer');
const scenarioReady =
  fs.existsSync(path.join(producerRoot, 'gradle/wrapper/gradle-wrapper.jar')) &&
  fs.existsSync(path.join(consumerRoot, 'gradle/wrapper/gradle-wrapper.jar'));

async function runGradle(projectDir: string, task: string): Promise<void> {
  const proc = Bun.spawn([path.join(projectDir, 'gradlew'), task, '--no-daemon', '--quiet'], {
    cwd: projectDir,
    env: { ...process.env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Gradle task '${task}' in ${projectDir} exited with code ${code}`);
  }
}

describe.skipIf(!scenarioReady)('gradle/kotlin-library scenario (real Gradle)', () => {
  let tmpDir: string;
  let prevCache: string | undefined;
  let prevLocalRepo: string | undefined;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-kotlin-lib-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    prevLocalRepo = process.env.JVMSRC_LOCAL_MAVEN_REPO;
    process.env.JVMSRC_CACHE_ROOT = path.join(tmpDir, 'cache');
    process.env.JVMSRC_LOCAL_MAVEN_REPO = path.join(tmpDir, 'local-repo');
    fs.mkdirSync(process.env.JVMSRC_LOCAL_MAVEN_REPO, { recursive: true });
    await runGradle(producerRoot, 'publish');
  });

  afterAll(() => {
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    if (prevLocalRepo === undefined) {
      delete process.env.JVMSRC_LOCAL_MAVEN_REPO;
    } else {
      process.env.JVMSRC_LOCAL_MAVEN_REPO = prevLocalRepo;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('shouldReturnKotlinClassSourceWhenSourcesJarHasKtFile', async () => {
    const got = await getClassSource('com.example.kt.Greeter', { projectRoot: consumerRoot, forceRefresh: true });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(true);
    expect(got.sourceLanguage).toBe('kotlin');
    expect(got.source).toContain('class Greeter');
    expect(got.source).toContain('fun greet(name: String)');
  });

  test('shouldReturnKotlinFileWhenFacadeClassIsRequested', async () => {
    const got = await getClassSource('com.example.kt.GreetKt', { projectRoot: consumerRoot });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(true);
    expect(got.sourceLanguage).toBe('kotlin');
    expect(got.source).toContain('fun shout(text: String)');
    expect(got.provenance.kind).toBe('sourcesJar');
    if (got.provenance.kind === 'sourcesJar') {
      expect(got.provenance.sourceRelativePath).toBe('com/example/kt/Greet.kt');
      expect(got.provenance.nestedIn).toBeUndefined();
    }
  });

  test('shouldReturnOnlyTheRequestedKotlinMembersWhenMethodNamesAreGiven', async () => {
    const got = await getClassSource('com.example.kt.Greeter', {
      projectRoot: consumerRoot,
      excerpt: { methodNames: ['greet', 'getTone'] },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.source).toContain('/** Says hello to [name]. */');
    expect(got.source).toContain('fun greet(name: String)');
    expect(got.source).toContain('var tone: String');
    expect(got.source).not.toContain('farewell');
    expect(got.excerpt?.matchedMethodNames).toEqual(['greet', 'getTone']);
  });

  test('shouldReturnLinesWhenKotlinExcerptUsesLineRange', async () => {
    const got = await getClassSource('com.example.kt.Greeter', {
      projectRoot: consumerRoot,
      excerpt: { startLine: 6, endLine: 6 },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.source.trim()).toBe('fun greet(name: String): String = "Hello, $name"');
    expect(got.excerpt?.startLine).toBe(6);
  });

  test('shouldReturnOnlyOneClassWhenAKotlinFileDeclaresSeveral', async () => {
    const got = await getClassSource('com.example.kt.Square', { projectRoot: consumerRoot });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.source.startsWith('// jvmsrc: com/example/kt/Shapes.kt:6-7\n')).toBe(true);
    expect(got.source).toContain('class Square(val side: Double)');
    expect(got.source).not.toContain('Circle');
    expect(got.sourceLanguage).toBe('kotlin');
  });

  test('shouldShowKdocAndParameterNamesWhenStructureIsRequestedForKotlinClass', async () => {
    const got = await getClassStructure('com.example.kt.Greeter', { projectRoot: consumerRoot, scope: 'declared' });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(true);
    expect(got.sourceLanguage).toBe('kotlin');
    expect(got.classPurpose).toBe('Builds greetings.');
    const greet = got.methods.find((m) => m.name === 'greet')!;
    expect(greet.javadoc).toBe('Says hello to [name].');
    expect(greet.parameters.map((p) => p.name)).toEqual(['name']);
    const getter = got.methods.find((m) => m.name === 'getTone')!;
    expect(getter.javadoc).toBe('The tone of the greeting.');
    expect(got.methods.find((m) => m.name === 'setTone')!.parameters.map((p) => p.name)).toEqual(['value']);
    expect(got.methods.find((m) => m.name === 'farewell')!.javadoc).toBeNull();
  });

  test('shouldFindTheKotlinDeclarationWhenAJvmNameIsGivenToGetMethodSignature', async () => {
    const got = await getMethodSignatures('com.example.kt.Greeter', 'setTone', { projectRoot: consumerRoot });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(true);
    expect(got.sourceLanguage).toBe('kotlin');
    expect(got.methodFound).toBe(true);
    expect(got.overloads[0]!.parameters.map((p) => p.name)).toEqual(['value']);
    expect(got.provenance.kind).toBe('sourcesJar');
  });

  test('shouldNameTheSyntheticReceiverWhenAKotlinFacadeFunctionIsRequested', async () => {
    const got = await getMethodSignatures('com.example.kt.GreetKt', 'shout', { projectRoot: consumerRoot });
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    expect(got.sourceAvailable).toBe(true);
    expect(got.overloads[0]!.parameters.map((p) => p.name)).toEqual(['text']);
  });
});
