import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runJavaDoctor } from './doctor-java.js';

function writeReleaseFile(jdkHome: string, javaVersion: string): void {
  fs.mkdirSync(jdkHome, { recursive: true });
  fs.writeFileSync(path.join(jdkHome, 'release'), `JAVA_VERSION="${javaVersion}"\n`);
}

const hermeticLinux = (homeDir: string) =>
  ({
    homeDir,
    platform: 'linux' as const,
    includeSystemLocations: false,
    includeConfiguredRoots: false,
  }) as const;

describe('runJavaDoctor', () => {
  let tmpRoot = '';

  afterEach(() => {
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = '';
    }
  });

  test('reports OK with selected compatible JDK', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-doc-java-'));
    fs.mkdirSync(path.join(tmpRoot, 'gradle', 'wrapper'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl=https://services.gradle.org/distributions/gradle-7.4.2-bin.zip\n',
      'utf8',
    );

    const jdk17 = path.join(tmpRoot, '.jdks', 'temurin-17');
    const jdk25 = path.join(tmpRoot, '.jdks', 'temurin-25');
    writeReleaseFile(jdk17, '17.0.11');
    writeReleaseFile(jdk25, '25.0.1');

    const report = runJavaDoctor(tmpRoot, {
      env: { JAVA_HOME: jdk25 },
      ctx: hermeticLinux(tmpRoot),
    });

    expect(report.ok).toBe(true);
    expect(report.text).toContain('Status: OK');
    expect(report.text).toContain(jdk17);
    expect(report.text).toContain('Candidate scan');
  });

  test('reports FAIL and guidance when no compatible JDK exists', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-doc-java-'));
    fs.mkdirSync(path.join(tmpRoot, 'gradle', 'wrapper'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl=https://services.gradle.org/distributions/gradle-8.8-bin.zip\n',
      'utf8',
    );

    const report = runJavaDoctor(tmpRoot, {
      env: {},
      ctx: hermeticLinux(tmpRoot),
    });

    expect(report.ok).toBe(false);
    expect(report.text).toContain('Status: FAIL');
    expect(report.text).toContain('jvmsrc config jdk-roots add /path/to/jdks');
  });

  test('uses persisted javaToolchainVersion from resolution cache when not explicitly passed', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-doc-java-'));
    const cacheDir = path.join(tmpRoot, 'cache');
    const projDir = path.join(tmpRoot, 'proj');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'build.gradle'), 'plugins { id("java") }\n', 'utf8');

    const jdk17 = path.join(tmpRoot, '.jdks', 'temurin-17');
    const jdk21 = path.join(tmpRoot, '.jdks', 'temurin-21');
    writeReleaseFile(jdk17, '17.0.11');
    writeReleaseFile(jdk21, '21.0.4');

    const prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = cacheDir;
    try {
      const { computeBuildInputsDigest, writeCachedResolution } = require('../cache/index.js') as typeof import('../cache/index.js');
      const { canonicalProjectRoot } = require('../cache/paths.js') as typeof import('../cache/paths.js');
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
          javaToolchainVersion: 17,
        },
        computeBuildInputsDigest(canonical),
      );

      const report = runJavaDoctor(canonical, {
        env: { JAVA_HOME: jdk21 },
        ctx: hermeticLinux(tmpRoot),
      });
      expect(report.ok).toBe(true);
      expect(report.text).toContain('hint=cached-toolchain');
      expect(report.text).toContain(jdk17);
    } finally {
      if (prevCache === undefined) {
        delete process.env.JVMSRC_CACHE_ROOT;
      } else {
        process.env.JVMSRC_CACHE_ROOT = prevCache;
      }
    }
  });
});
