import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addGlobalJdkSearchRoot,
  readGlobalConfig,
  removeGlobalJdkSearchRoot,
  resolveGlobalConfigPath,
} from './global-config.js';

let tmp = '';
let prevConfigDir: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-conf-'));
  prevConfigDir = process.env.JVMSRC_CONFIG_DIR;
  process.env.JVMSRC_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (prevConfigDir === undefined) {
    delete process.env.JVMSRC_CONFIG_DIR;
  } else {
    process.env.JVMSRC_CONFIG_DIR = prevConfigDir;
  }
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  }
});

test('add/list/remove JDK roots in global config', () => {
  const rootA = path.join(tmp, 'jdks-a');
  const rootB = path.join(tmp, 'jdks-b');
  fs.mkdirSync(rootA, { recursive: true });
  fs.mkdirSync(rootB, { recursive: true });

  const addA = addGlobalJdkSearchRoot(rootA);
  const addB = addGlobalJdkSearchRoot(rootB);
  const addAAgain = addGlobalJdkSearchRoot(rootA);

  expect(addA.ok).toBe(true);
  expect(addB.ok).toBe(true);
  expect(addAAgain.ok).toBe(true);
  if (!addA.ok || !addB.ok || !addAAgain.ok) {
    return;
  }

  expect(addA.value.added).toBe(true);
  expect(addAAgain.value.added).toBe(false);

  const cfg = readGlobalConfig();
  expect(cfg.ok).toBe(true);
  if (!cfg.ok) {
    return;
  }
  expect(cfg.value.jdkSearchRoots).toEqual([rootA, rootB]);

  const rmA = removeGlobalJdkSearchRoot(rootA);
  expect(rmA.ok).toBe(true);
  if (!rmA.ok) {
    return;
  }
  expect(rmA.value.removed).toBe(true);

  const cfgAfter = readGlobalConfig();
  expect(cfgAfter.ok).toBe(true);
  if (!cfgAfter.ok) {
    return;
  }
  expect(cfgAfter.value.jdkSearchRoots).toEqual([rootB]);

  expect(resolveGlobalConfigPath()).toBe(path.join(tmp, 'config.json'));
});

test('rejects relative JVMSRC_CONFIG_DIR override', () => {
  process.env.JVMSRC_CONFIG_DIR = 'relative/config';
  const cfg = readGlobalConfig();
  expect(cfg.ok).toBe(false);
  if (!cfg.ok) {
    expect(cfg.message).toContain('JVMSRC_CONFIG_DIR must be set to an absolute path');
  }
});
