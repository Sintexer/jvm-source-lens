import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveGradleWrapperCommand } from './gradle-wrapper-command.js';

describe('resolveGradleWrapperCommand', () => {
  let savedPlatform: string | undefined;
  let tmpDir: string;

  afterEach(() => {
    if (savedPlatform === undefined) {
      delete process.env.JVMSRC_TEST_PLATFORM;
    } else {
      process.env.JVMSRC_TEST_PLATFORM = savedPlatform;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(): void {
    savedPlatform = process.env.JVMSRC_TEST_PLATFORM;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-gw-'));
  }

  test('win32 prefers gradlew.bat (no cmd.exe in argv)', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'win32';
    const bat = path.join(tmpDir, 'gradlew.bat');
    const unix = path.join(tmpDir, 'gradlew');
    fs.writeFileSync(bat, '@echo off\r\n');
    fs.writeFileSync(unix, '#!/bin/sh\n');

    const r = resolveGradleWrapperCommand(tmpDir);
    expect(r.useWrapper).toBe(true);
    expect(r.command).toEqual([bat]);
  });

  test('win32 without .bat uses gradlew path only', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'win32';
    const unix = path.join(tmpDir, 'gradlew');
    fs.writeFileSync(unix, '#!/bin/sh\n');

    const r = resolveGradleWrapperCommand(tmpDir);
    expect(r.useWrapper).toBe(true);
    expect(r.command).toEqual([unix]);
  });

  test('win32 with no wrapper uses gradle on PATH', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'win32';

    const r = resolveGradleWrapperCommand(tmpDir);
    expect(r.useWrapper).toBe(false);
    expect(r.command).toEqual(['gradle']);
  });

  test('unix uses executable gradlew when mode allows', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'linux';
    const unix = path.join(tmpDir, 'gradlew');
    fs.writeFileSync(unix, '#!/bin/sh\n', { mode: 0o755 });

    const r = resolveGradleWrapperCommand(tmpDir);
    expect(r.useWrapper).toBe(true);
    expect(r.command).toEqual([unix]);
  });

  test('unix non-executable gradlew uses sh', () => {
    setup();
    process.env.JVMSRC_TEST_PLATFORM = 'linux';
    const unix = path.join(tmpDir, 'gradlew');
    fs.writeFileSync(unix, '#!/bin/sh\n', { mode: 0o644 });

    const r = resolveGradleWrapperCommand(tmpDir);
    expect(r.useWrapper).toBe(true);
    expect(r.command).toEqual(['sh', unix]);
  });
});
