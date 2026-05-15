import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCfrJarPath } from './resolve-cfr-jar.js';

const savedJvmsrc = process.env.JVMSRC_CFR_PATH;
const savedOracle = process.env.JVM_ORACLE_CFR_PATH;

afterEach(() => {
  if (savedJvmsrc === undefined) {
    delete process.env.JVMSRC_CFR_PATH;
  } else {
    process.env.JVMSRC_CFR_PATH = savedJvmsrc;
  }
  if (savedOracle === undefined) {
    delete process.env.JVM_ORACLE_CFR_PATH;
  } else {
    process.env.JVM_ORACLE_CFR_PATH = savedOracle;
  }
});

test('resolveCfrJarPath prefers JVMSRC_CFR_PATH over JVM_ORACLE_CFR_PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfr-'));
  const jar = path.join(dir, 'custom.jar');
  fs.writeFileSync(jar, 'not a real jar');
  process.env.JVM_ORACLE_CFR_PATH = path.join(dir, 'wrong.jar');
  process.env.JVMSRC_CFR_PATH = jar;
  const r = resolveCfrJarPath();
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.path).toBe(jar);
  }
});

test('resolveCfrJarPath uses JVM_ORACLE_CFR_PATH when JVMSRC unset', () => {
  delete process.env.JVMSRC_CFR_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfr2-'));
  const jar = path.join(dir, 'legacy.jar');
  fs.writeFileSync(jar, 'x');
  process.env.JVM_ORACLE_CFR_PATH = jar;
  const r = resolveCfrJarPath();
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.path).toBe(jar);
  }
});

test('resolveCfrJarPath rejects missing override path', () => {
  process.env.JVMSRC_CFR_PATH = path.join(os.tmpdir(), 'definitely-missing-cfr.jar');
  const r = resolveCfrJarPath();
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.message).toContain('JVMSRC_CFR_PATH');
    expect(r.message).toContain('not found');
  }
});

test('resolveCfrJarPath rejects non-jar extension', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfr3-'));
  const txt = path.join(dir, 'cfr.txt');
  fs.writeFileSync(txt, 'x');
  process.env.JVMSRC_CFR_PATH = txt;
  const r = resolveCfrJarPath();
  expect(r.ok).toBe(false);
});

test('resolveCfrJarPath falls back to bundled when env unset', () => {
  delete process.env.JVMSRC_CFR_PATH;
  delete process.env.JVM_ORACLE_CFR_PATH;
  const r = resolveCfrJarPath();
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.path.toLowerCase().endsWith('.jar')).toBe(true);
    expect(fs.existsSync(r.path)).toBe(true);
  }
});
