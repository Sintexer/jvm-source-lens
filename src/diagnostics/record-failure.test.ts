import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordFailureDiagnostic } from './record-failure.js';

let tmp: string;
let prev: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-rec-'));
  prev = process.env.JVMSRC_LOG_DIR;
  process.env.JVMSRC_LOG_DIR = tmp;
});
afterEach(() => {
  if (prev === undefined) {
    delete process.env.JVMSRC_LOG_DIR;
  } else {
    process.env.JVMSRC_LOG_DIR = prev;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('recordFailureDiagnostic does not throw', () => {
  expect(() =>
    recordFailureDiagnostic({
      operation: 'test',
      publicCode: 'RESOLUTION_FAILED',
      message: 'boom',
      projectRoot: tmp,
    }),
  ).not.toThrow();
});

test('recordFailureDiagnostic writes resolver_fail snapshot', () => {
  const r = recordFailureDiagnostic({
    operation: 'test',
    publicCode: 'RESOLUTION_FAILED',
    message: 'Gradle exited with code 1',
    projectRoot: tmp,
  });
  expect(fs.existsSync(path.join(tmp, 'current.log'))).toBe(true);
  expect(r.diagnosticId).toBeDefined();
  expect(r.hint).toContain('diagnostics show');
  const files = fs.readdirSync(path.join(tmp, 'diagnostics'));
  expect(files.some((f) => f.endsWith('.json'))).toBe(true);
});

test('INVALID_PROJECT_ROOT skips java -version probe', () => {
  const t0 = performance.now();
  recordFailureDiagnostic({
    operation: 'mcp_tool',
    publicCode: 'INVALID_PROJECT_ROOT',
    message: 'Project path does not exist: /nope',
    projectRoot: '/nope',
    buildSystem: null,
  });
  expect(performance.now() - t0).toBeLessThan(500);
});

test('relative JVMSRC_LOG_DIR skips write without throwing', () => {
  process.env.JVMSRC_LOG_DIR = 'relative/logs';
  expect(
    recordFailureDiagnostic({
      operation: 'test',
      publicCode: 'RESOLUTION_FAILED',
      message: 'x',
      projectRoot: tmp,
    }),
  ).toEqual({});
});
