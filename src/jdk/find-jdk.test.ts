import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findJdk, jdkSearchLocations } from './find-jdk.js';

function writeReleaseFile(jdkHome: string, javaVersion: string): void {
  fs.mkdirSync(jdkHome, { recursive: true });
  fs.writeFileSync(path.join(jdkHome, 'release'), `JAVA_VERSION="${javaVersion}"\n`);
}

describe('findJdk', () => {
  let tmpHome = '';
  let prevConfigDir: string | undefined;

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.JVMSRC_CONFIG_DIR;
    } else {
      process.env.JVMSRC_CONFIG_DIR = prevConfigDir;
      prevConfigDir = undefined;
    }
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      tmpHome = '';
    }
  });

  test('finds matching JDK in IntelliJ ~/.jdks', () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-jdks-'));
    const jdkHome = path.join(tmpHome, '.jdks', 'temurin-25');
    writeReleaseFile(jdkHome, '25.0.1');

    const found = findJdk(25, {}, { homeDir: tmpHome, platform: 'linux' });
    expect(found).not.toBeNull();
    expect(found?.jdkHome).toBe(jdkHome);
    expect(found?.majorVersion).toBe(25);
    expect(found?.source).toBe('intellij-jdks');
  });

  test('supports IntelliJ macOS bundle layout under ~/.jdks', () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-jdks-'));
    const bundleHome = path.join(tmpHome, '.jdks', 'temurin-21.jdk', 'Contents', 'Home');
    writeReleaseFile(bundleHome, '21.0.7');

    const found = findJdk(21, {}, { homeDir: tmpHome, platform: 'darwin' });
    expect(found).not.toBeNull();
    expect(found?.jdkHome).toBe(bundleHome);
    expect(found?.source).toBe('intellij-jdks');
  });

  test('finds JDK in Windows Program Files vendor folders', () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-jdks-'));
    const programFiles = path.join(tmpHome, 'ProgramFiles');
    const winJdk = path.join(programFiles, 'Eclipse Adoptium', 'jdk-21.0.6.7-hotspot');
    writeReleaseFile(winJdk, '21.0.6');

    const found = findJdk(
      21,
      { ProgramFiles: programFiles },
      { homeDir: tmpHome, platform: 'win32' },
    );

    expect(found).not.toBeNull();
    expect(found?.jdkHome).toBe(winJdk);
    expect(found?.source).toBe('windows-system');
  });

  test('finds JDK from configured jdk-roots directory', () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-jdks-'));
    const configDir = path.join(tmpHome, 'cfg');
    const root = path.join(tmpHome, 'my-jdks');
    const jdkHome = path.join(root, 'zulu-21.0.2');
    fs.mkdirSync(root, { recursive: true });
    writeReleaseFile(jdkHome, '21.0.2');

    prevConfigDir = process.env.JVMSRC_CONFIG_DIR;
    process.env.JVMSRC_CONFIG_DIR = configDir;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ schemaVersion: 1, jdkSearchRoots: [root] }, null, 2),
      'utf8',
    );

    const found = findJdk(21, {}, { homeDir: tmpHome, platform: 'linux' });
    expect(found).not.toBeNull();
    expect(found?.jdkHome).toBe(jdkHome);
    expect(found?.source).toBe('configured-jdk-root');
  });
});

describe('jdkSearchLocations', () => {
  test('includes IntelliJ ~/.jdks location', () => {
    const locations = jdkSearchLocations();
    expect(locations.some((l) => l.includes('.jdks'))).toBe(true);
  });

  test('includes configured jdk-roots in locations list', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-loc-'));
    const configDir = path.join(tmp, 'cfg');
    const root = path.join(tmp, 'custom-jdks');
    const prev = process.env.JVMSRC_CONFIG_DIR;
    process.env.JVMSRC_CONFIG_DIR = configDir;
    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({ schemaVersion: 1, jdkSearchRoots: [root] }, null, 2),
        'utf8',
      );
      const locations = jdkSearchLocations();
      expect(locations.some((l) => l.includes('(configured jdk-root)') && l.includes(root))).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.JVMSRC_CONFIG_DIR;
      } else {
        process.env.JVMSRC_CONFIG_DIR = prev;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
