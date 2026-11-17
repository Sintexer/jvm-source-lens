import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getClassSource } from '../../../../src/get-class-source.js';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';

setDefaultTimeout(120_000);

const scenarioRoot = path.resolve(import.meta.dir);
const producerRoot = path.join(scenarioRoot, 'producer');
const consumerRoot = path.join(scenarioRoot, 'consumer');
const producerWrapperJar = path.join(producerRoot, '.mvn/wrapper/maven-wrapper.jar');
const consumerWrapperJar = path.join(consumerRoot, '.mvn/wrapper/maven-wrapper.jar');
const greeterSrc = path.join(producerRoot, 'src/main/java/com/example/snap/SnapGreeter.java');

const scenarioReady = fs.existsSync(producerWrapperJar) && fs.existsSync(consumerWrapperJar);
const m2SnapNamespace = path.join(os.homedir(), '.m2', 'repository', 'com', 'example', 'mvnsnap');

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

describe.skipIf(!scenarioReady)('maven/local-install-snapshot scenario (real Maven)', () => {
  let prevCache: string | undefined;
  let tmpCache = '';
  let originalSrc = '';

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-snap-cache-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
    originalSrc = fs.readFileSync(greeterSrc, 'utf8');
    fs.rmSync(m2SnapNamespace, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.writeFileSync(greeterSrc, originalSrc, 'utf8');
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    fs.rmSync(path.join(producerRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(m2SnapNamespace, { recursive: true, force: true });
    fs.rmSync(tmpCache, { recursive: true, force: true });
  });

  test('shouldInvalidateCacheAutomaticallyWhenSnapshotIsReinstalledToLocalM2WithoutForceRefresh', async () => {
    // 1. Install initial 1.0.0-SNAPSHOT into ~/.m2/repository
    await runMvnw(producerRoot, 'install', '-DskipTests');

    const r1 = await resolveWithResolutionCache(consumerRoot, { forceRefresh: false });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    // Warm read with unchanged SNAPSHOT JAR hits the cache
    const rWarm = await resolveWithResolutionCache(consumerRoot, { forceRefresh: false });
    expect(rWarm.ok).toBe(true);
    if (rWarm.ok) {
      expect(rWarm.output.resolvedAt).toBe(r1.output.resolvedAt);
    }

    const srcV1 = await getClassSource('com.example.snap.SnapGreeter', {
      projectRoot: consumerRoot,
    });
    expect(srcV1.ok).toBe(true);
    if (srcV1.ok) {
      expect(srcV1.source).toContain('greet');
      expect(srcV1.source).not.toContain('farewell');
    }

    // 2. Add farewell() and run `mvn install` again (overwriting 1.0.0-SNAPSHOT in ~/.m2/repository)
    const updatedSrc = originalSrc.replace(
      /(\s*}\s*)$/,
      '\n  public String farewell(String name) {\n    return "Bye, " + name + "!";\n  }\n$1',
    );
    fs.writeFileSync(greeterSrc, updatedSrc, 'utf8');
    await runMvnw(producerRoot, 'install', '-DskipTests');

    // 3. Resolve WITHOUT forceRefresh — local-artifact.hash detects mutated SNAPSHOT in ~/.m2
    const r2 = await resolveWithResolutionCache(consumerRoot, { forceRefresh: false });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.output.resolvedAt).not.toBe(r1.output.resolvedAt);
    }

    const srcV2 = await getClassSource('com.example.snap.SnapGreeter', {
      projectRoot: consumerRoot,
    });
    expect(srcV2.ok).toBe(true);
    if (srcV2.ok) {
      expect(srcV2.source).toContain('farewell');
    }

    expect(fs.existsSync(path.join(consumerRoot, 'target'))).toBe(false);
  });
});
