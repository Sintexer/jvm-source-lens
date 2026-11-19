import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { createTempLocalRepo, runMvnw, type TempLocalRepo } from '../_helpers.js';
import { getClassSource } from '../../../../src/get-class-source.js';
import { getClassStructure } from '../../../../src/get-class-structure.js';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';
import { searchClasses } from '../../../../src/search-classes.js';
import { searchInArtifact } from '../../../../src/search-in-artifact.js';

setDefaultTimeout(120_000);

const scenarioRoot = path.resolve(import.meta.dir);
const sourcedRoot = path.join(scenarioRoot, 'producer-sourced');
const binaryRoot = path.join(scenarioRoot, 'producer-binary');
const appRoot = path.join(scenarioRoot, 'app');

const sourcedWrapperJar = path.join(sourcedRoot, '.mvn/wrapper/maven-wrapper.jar');
const binaryWrapperJar = path.join(binaryRoot, '.mvn/wrapper/maven-wrapper.jar');
const appWrapperJar = path.join(appRoot, '.mvn/wrapper/maven-wrapper.jar');

const scenarioReady =
  fs.existsSync(sourcedWrapperJar) &&
  fs.existsSync(binaryWrapperJar) &&
  fs.existsSync(appWrapperJar);

let sharedTmpDir = '';
let remoteFileRepo = '';
const m2CachedGroup = 'com/example/mvnsingle';
let m2: TempLocalRepo;

if (scenarioReady) {
  beforeAll(async () => {
    m2 = createTempLocalRepo('jvmsrc-mvn-single');
    sharedTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-single-'));
    remoteFileRepo = path.join(sharedTmpDir, 'remote-repo');
    fs.mkdirSync(remoteFileRepo, { recursive: true });
    process.env.JVMSRC_LOCAL_MAVEN_REPO = remoteFileRepo;

    const deployArg = `-DaltDeploymentRepository=local::file://${remoteFileRepo}`;
    await runMvnw(
      sourcedRoot,
      'package',
      'org.apache.maven.plugins:maven-deploy-plugin:3.1.2:deploy',
      '-DskipTests',
      deployArg,
    );
    await runMvnw(
      binaryRoot,
      'package',
      'org.apache.maven.plugins:maven-deploy-plugin:3.1.2:deploy',
      '-DskipTests',
      deployArg,
    );
    // Clean producer target/ and ensure the temp local repo has NOT pre-cached com.example.mvnsingle
    // so consumer exercises real Maven download + on-demand sources resolution.
    fs.rmSync(path.join(sourcedRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(path.join(binaryRoot, 'target'), { recursive: true, force: true });
    m2.clearGroup(m2CachedGroup);
  });

  afterAll(() => {
    delete process.env.JVMSRC_LOCAL_MAVEN_REPO;
    m2.dispose();
    fs.rmSync(path.join(sourcedRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(path.join(binaryRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(sharedTmpDir, { recursive: true, force: true });
  });
}

describe.skipIf(!scenarioReady)('maven/single-module scenario (real Maven)', () => {
  let prevCache: string | undefined;
  let tmpCache = '';

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-single-cache-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
    m2.clearGroup(m2CachedGroup);
  });

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    fs.rmSync(tmpCache, { recursive: true, force: true });
  });

  test('shouldResolveDependenciesExtractSourcesDecompileWithCfrAndNeverCreateTarget', async () => {
    const resolved = await resolveWithResolutionCache(appRoot, { forceRefresh: true });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.output.buildSystem.type).toBe('maven');
    expect(resolved.output.buildSystem.wrapper).toBe(true);
    expect(resolved.output.javaToolchainVersion).toBe(17);
    expect(resolved.output.modules[0]?.configurations.map((c) => c.name)).toEqual([
      'compile',
      'runtime',
      'test',
    ]);
    expect(fs.existsSync(path.join(appRoot, 'target'))).toBe(false);

    // 1. Sources JAR path (downloaded on demand via MavenResolver.resolveSourcesJar)
    const sourced = await getClassSource('com.example.sourced.Greeter', { projectRoot: appRoot });
    expect(sourced.ok).toBe(true);
    if (sourced.ok) {
      expect(sourced.sourceAvailable).toBe(true);
      expect(sourced.sourceLanguage).toBe('java');
      expect(sourced.provenance.kind).toBe('sourcesJar');
      expect(sourced.source).toContain('Hello from Maven sources');
    }

    // 2. CFR fallback path when no -sources.jar exists
    const decompiled = await getClassSource('com.example.binary.MysteryBox', {
      projectRoot: appRoot,
    });
    expect(decompiled.ok).toBe(true);
    if (decompiled.ok) {
      expect(decompiled.sourceAvailable).toBe(false);
      expect(decompiled.provenance.kind).toBe('decompiled');
      expect(decompiled.source).toContain('4242');
    }

    // 3. Structured class API reads Javadoc and parameter names
    const structure = await getClassStructure('com.example.sourced.Greeter', {
      projectRoot: appRoot,
      scope: 'declared',
    });
    expect(structure.ok).toBe(true);
    if (structure.ok) {
      expect(structure.classPurpose).toContain('Friendly greeter');
      const greetMethod = structure.methods.find((m) => m.name === 'greet');
      expect(greetMethod?.parameters[0]?.name).toBe('who');
    }

    // 4. Class search finds classes across resolved Maven classpath JARs
    const classes = await searchClasses({ projectRoot: appRoot, query: 'MysteryBox' });
    expect(classes.ok).toBe(true);
    if (classes.ok) {
      expect(classes.hits.map((h) => h.className)).toEqual(['com.example.binary.MysteryBox']);
    }

    // 5. search_in_artifact scans the Maven artifact via on-demand sources JAR
    const artSearch = await searchInArtifact({
      projectRoot: appRoot,
      selector: { coordinates: { group: 'com.example.mvnsingle', name: 'sourced-lib' } },
      query: 'Hello from Maven sources',
    });
    expect(artSearch.ok).toBe(true);
    if (artSearch.ok && artSearch.found) {
      expect(artSearch.hits.map((h) => h.className)).toEqual(['com.example.sourced.Greeter']);
    }

    // No target/ created anywhere under consumer project
    expect(fs.existsSync(path.join(appRoot, 'target'))).toBe(false);
  });
});
