import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMavenWrapperCommand } from './maven-wrapper-command.js';

function restoreEnv(name: string, saved: string | undefined): void {
  if (saved === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = saved;
  }
}

describe('resolveMavenWrapperCommand', () => {
  const envKeys = [
    'JVMSRC_TEST_PLATFORM',
    'JVMSRC_USE_SYSTEM_MAVEN',
    'JVMSRC_MAVEN_BIN',
    'MAVEN_HOME',
    'M2_HOME',
  ] as const;
  let savedEnv: Record<string, string | undefined> = {};
  let tmpDir = '';

  function setup(): void {
    savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mw-'));
  }

  afterEach(() => {
    for (const key of envKeys) {
      restoreEnv(key, savedEnv[key]);
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  test('shouldPreferExecutableMvnwOnUnixAndUseShWhenNonExecutable', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'linux';
    const unix = path.join(tmpDir, 'mvnw');
    fs.writeFileSync(unix, '#!/bin/sh\n', { mode: 0o755 });
    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: true,
      command: [unix],
    });

    fs.chmodSync(unix, 0o644);
    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: true,
      command: ['sh', unix],
    });
  });

  test('shouldPreferMvnwCmdOnWin32', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'win32';
    const cmd = path.join(tmpDir, 'mvnw.cmd');
    const unix = path.join(tmpDir, 'mvnw');
    fs.writeFileSync(cmd, '@echo off\r\n');
    fs.writeFileSync(unix, '#!/bin/sh\n');
    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: true,
      command: [cmd],
    });
  });

  test('shouldSkipWrapperAndIgnoreLfsPointerWhenUseSystemMavenIsOne', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'linux';
    fs.writeFileSync(path.join(tmpDir, 'mvnw'), '#!/bin/sh\n', { mode: 0o755 });
    const jarDir = path.join(tmpDir, '.mvn', 'wrapper');
    fs.mkdirSync(jarDir, { recursive: true });
    fs.writeFileSync(
      path.join(jarDir, 'maven-wrapper.jar'),
      'version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 12345\n',
    );
    process.env.JVMSRC_USE_SYSTEM_MAVEN = '1';

    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: false,
      command: ['mvn'],
    });
  });

  test('shouldFlagLfsPointerJarAndAllowOnlyScriptWrapperWithoutJar', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'linux';
    const unix = path.join(tmpDir, 'mvnw');
    fs.writeFileSync(unix, '#!/bin/sh\n', { mode: 0o755 });

    // only-script wrapper has no maven-wrapper.jar
    expect(resolveMavenWrapperCommand(tmpDir).lfsPointerJar).toBeUndefined();

    // Git LFS pointer jar
    const jarDir = path.join(tmpDir, '.mvn', 'wrapper');
    fs.mkdirSync(jarDir, { recursive: true });
    fs.writeFileSync(
      path.join(jarDir, 'maven-wrapper.jar'),
      'version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 12345\n',
    );
    expect(resolveMavenWrapperCommand(tmpDir).lfsPointerJar).toBe(true);
  });

  test('shouldResolveSystemMavenFromJvmsrcMavenBinThenMavenHomeThenPath', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'linux';

    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: false,
      command: ['mvn'],
    });

    const fakeHome = path.join(tmpDir, 'apache-maven');
    const homeBin = path.join(fakeHome, 'bin', 'mvn');
    fs.mkdirSync(path.dirname(homeBin), { recursive: true });
    fs.writeFileSync(homeBin, '#!/bin/sh\n', { mode: 0o755 });
    process.env.MAVEN_HOME = fakeHome;

    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: false,
      command: [homeBin],
    });

    process.env.JVMSRC_MAVEN_BIN = '/custom/bin/mvn';
    expect(resolveMavenWrapperCommand(tmpDir)).toEqual({
      useWrapper: false,
      command: ['/custom/bin/mvn'],
    });
  });
});
