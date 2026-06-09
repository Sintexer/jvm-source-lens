import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveJdkForProject } from './resolve-jdk-for-project.js';

function writeReleaseFile(jdkHome: string, javaVersion: string): void {
  fs.mkdirSync(jdkHome, { recursive: true });
  fs.writeFileSync(path.join(jdkHome, 'release'), `JAVA_VERSION="${javaVersion}"\n`);
}

describe('resolveJdkForProject', () => {
  let tmpRoot = '';

  afterEach(() => {
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = '';
    }
  });

  test('for gradle-wrapper-inferred, overrides too-new JAVA_HOME with compatible local JDK', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-resolve-jdk-'));

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

    const result = resolveJdkForProject(
      tmpRoot,
      undefined,
      { JAVA_HOME: jdk25 },
      { homeDir: tmpRoot, platform: 'linux' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.jdkHome).toBe(jdk17);
    expect(result.majorVersion).toBe(17);
    expect(result.hint.source).toBe('gradle-wrapper-inferred');
  });

  test('for gradle-wrapper-inferred, passes through current JAVA_HOME when within compatible range', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-resolve-jdk-'));

    fs.mkdirSync(path.join(tmpRoot, 'gradle', 'wrapper'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl=https://services.gradle.org/distributions/gradle-7.4.2-bin.zip\n',
      'utf8',
    );

    const jdk17 = path.join(tmpRoot, '.jdks', 'temurin-17');
    writeReleaseFile(jdk17, '17.0.11');

    const result = resolveJdkForProject(
      tmpRoot,
      undefined,
      { JAVA_HOME: jdk17 },
      { homeDir: tmpRoot, platform: 'linux' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.jdkHome).toBe(jdk17);
    expect(result.majorVersion).toBe(17);
  });
});
