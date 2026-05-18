import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveJavaBinExecutable } from './resolve-java-bin.js';

describe('resolveJavaBinExecutable', () => {
  let savedHome: string | undefined;
  let savedPlatform: string | undefined;
  let tmpDir: string;

  afterEach(() => {
    if (savedHome === undefined) {
      delete process.env.JAVA_HOME;
    } else {
      process.env.JAVA_HOME = savedHome;
    }
    if (savedPlatform === undefined) {
      delete process.env.JVMSRC_TEST_PLATFORM;
    } else {
      process.env.JVMSRC_TEST_PLATFORM = savedPlatform;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('win32 prefers java.exe under JAVA_HOME', () => {
    savedHome = process.env.JAVA_HOME;
    savedPlatform = process.env.JVMSRC_TEST_PLATFORM;
    process.env.JVMSRC_TEST_PLATFORM = 'win32';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-jdk-'));
    const bin = path.join(tmpDir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const exe = path.join(bin, 'java.exe');
    fs.writeFileSync(exe, '');
    process.env.JAVA_HOME = tmpDir;

    const r = resolveJavaBinExecutable('java');
    expect(r.path).toBe(exe);
  });
});
