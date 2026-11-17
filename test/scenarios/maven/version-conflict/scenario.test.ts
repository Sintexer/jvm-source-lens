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
import { getClassSource } from '../../../../src/get-class-source.js';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';

setDefaultTimeout(120_000);

/**
 * Real-Maven scenario: Maven uses **nearest-wins** conflict mediation (unlike Gradle's highest-wins).
 *
 * Dependency graph:
 *   conflict-app ──direct (depth 1)──▶ widget-lib:1.0.0  (render only)
 *   conflict-app ──direct (depth 1)──▶ adapter:1.0.0 ──(depth 2)──▶ widget-lib:2.0.0  (render + animate)
 *
 * Maven selects 1.0.0 because depth 1 < depth 2, even though 1.0.0 < 2.0.0.
 */

const scenarioRoot = path.resolve(import.meta.dir);
const libRoot = path.join(scenarioRoot, 'lib');
const adapterRoot = path.join(scenarioRoot, 'adapter');
const appRoot = path.join(scenarioRoot, 'app');

const libWrapperJar = path.join(libRoot, '.mvn/wrapper/maven-wrapper.jar');
const adapterWrapperJar = path.join(adapterRoot, '.mvn/wrapper/maven-wrapper.jar');
const appWrapperJar = path.join(appRoot, '.mvn/wrapper/maven-wrapper.jar');
const widgetSrc = path.join(libRoot, 'src/main/java/com/example/widget/Widget.java');

const scenarioReady =
  fs.existsSync(libWrapperJar) && fs.existsSync(adapterWrapperJar) && fs.existsSync(appWrapperJar);

async function runMvnw(projectDir: string, ...args: string[]): Promise<void> {
  const mvnw = path.join(projectDir, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  const proc = Bun.spawn([mvnw, '-B', '-q', ...args], {
    cwd: projectDir,
    env: { ...process.env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Maven ${args.join(' ')} in ${path.basename(projectDir)} exited with ${code}`);
  }
}

let sharedTmpDir = '';
let remoteRepo = '';
let originalWidgetSrc = '';
const m2CachedNamespace = path.join(os.homedir(), '.m2', 'repository', 'com', 'example', 'mvnvc');

if (scenarioReady) {
  beforeAll(async () => {
    fs.rmSync(m2CachedNamespace, { recursive: true, force: true });
    sharedTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-vc-'));
    remoteRepo = path.join(sharedTmpDir, 'remote-repo');
    fs.mkdirSync(remoteRepo, { recursive: true });
    process.env.JVMSRC_LOCAL_MAVEN_REPO = remoteRepo;
    originalWidgetSrc = fs.readFileSync(widgetSrc, 'utf8');

    const deployGoal = 'org.apache.maven.plugins:maven-deploy-plugin:3.1.2:deploy';
    const deployRepo = `-DaltDeploymentRepository=local::file://${remoteRepo}`;

    // Deploy widget-lib:1.0.0 (render only)
    await runMvnw(libRoot, 'package', deployGoal, '-Drevision=1.0.0', '-DskipTests', deployRepo);

    // Add animate() and deploy widget-lib:2.0.0, then restore Widget.java
    const v2Src = originalWidgetSrc.replace(
      /(\s*}\s*)$/,
      '\n  public String animate() {\n    return "animated";\n  }\n$1',
    );
    fs.writeFileSync(widgetSrc, v2Src, 'utf8');
    await runMvnw(libRoot, 'package', deployGoal, '-Drevision=2.0.0', '-DskipTests', deployRepo);
    fs.writeFileSync(widgetSrc, originalWidgetSrc, 'utf8');
    fs.rmSync(path.join(libRoot, '.flattened-pom.xml'), { force: true });

    // Deploy adapter:1.0.0 (depends on widget-lib:2.0.0)
    await runMvnw(adapterRoot, 'package', deployGoal, '-DskipTests', deployRepo);

    fs.rmSync(path.join(libRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(path.join(adapterRoot, 'target'), { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalWidgetSrc) {
      fs.writeFileSync(widgetSrc, originalWidgetSrc, 'utf8');
    }
    delete process.env.JVMSRC_LOCAL_MAVEN_REPO;
    fs.rmSync(path.join(libRoot, '.flattened-pom.xml'), { force: true });
    fs.rmSync(path.join(libRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(path.join(adapterRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(m2CachedNamespace, { recursive: true, force: true });
    fs.rmSync(sharedTmpDir, { recursive: true, force: true });
  });
}

describe.skipIf(!scenarioReady)('maven/version-conflict scenario (real Maven)', () => {
  let prevCache: string | undefined;
  let tmpCache = '';

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-vc-cache-'));
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

  test('shouldSelectDirectVersion100OverTransitive200ViaMavenNearestWins', async () => {
    const resolved = await resolveWithResolutionCache(appRoot, { forceRefresh: true });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compileCfg = resolved.output.modules[0]?.configurations.find((c) => c.name === 'compile');
    const widgetArtifacts = (compileCfg?.artifacts ?? []).filter((a) => a.name === 'widget-lib');
    expect(widgetArtifacts.map((a) => a.version)).toEqual(['1.0.0']);
    expect(widgetArtifacts[0]?.direct).toBe(true);

    const src = await getClassSource('com.example.widget.Widget', { projectRoot: appRoot });
    expect(src.ok).toBe(true);
    if (src.ok) {
      expect(src.sourceAvailable).toBe(true);
      expect(src.source).toContain('render');
      expect(src.source).not.toContain('animate');
    }

    expect(fs.existsSync(path.join(appRoot, 'target'))).toBe(false);
  });
});
