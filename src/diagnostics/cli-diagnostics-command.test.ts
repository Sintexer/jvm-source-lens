import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { registerDiagnosticsCli } from './cli-diagnostics-command.js';

let tmp = '';
let prevLogDir: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-diag-cli-'));
  prevLogDir = process.env.JVMSRC_LOG_DIR;
  process.env.JVMSRC_LOG_DIR = tmp;
});

afterEach(() => {
  if (prevLogDir === undefined) {
    delete process.env.JVMSRC_LOG_DIR;
  } else {
    process.env.JVMSRC_LOG_DIR = prevLogDir;
  }
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  }
});

function appendCurrentLog(lines: string[]): void {
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'current.log'), `${lines.join('\n')}\n`, 'utf8');
}

test('diagnostics last defaults to one most recent record', async () => {
  appendCurrentLog([
    JSON.stringify({
      id: '11111111-1111-1111-1111-111111111111',
      timestamp: '2026-01-01T00:00:00.000Z',
      severity: 'resolver_fail',
      toolVersion: '0.0.0',
      operation: 'op1',
      input: {},
      message: 'old message',
      errorCode: 'E1',
      stack: null,
      context: {
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20',
        javaVersion: null,
        gradleVersion: null,
        projectRoot: '/tmp/a',
        buildSystem: 'gradle',
        cacheDir: '/tmp/cache',
      },
    }),
    JSON.stringify({
      id: '22222222-2222-2222-2222-222222222222',
      timestamp: '2026-01-02T00:00:00.000Z',
      severity: 'resolver_fail',
      toolVersion: '0.0.0',
      operation: 'op2',
      input: {},
      message: 'new message',
      errorCode: 'E2',
      stack: null,
      context: {
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20',
        javaVersion: null,
        gradleVersion: null,
        projectRoot: '/tmp/b',
        buildSystem: 'gradle',
        cacheDir: '/tmp/cache',
      },
    }),
  ]);

  const program = new Command();
  registerDiagnosticsCli(program);

  const lines: string[] = [];
  const logSpy = (msg?: unknown) => {
    lines.push(String(msg ?? ''));
  };
  const prevLog = console.log;
  console.log = logSpy;
  try {
    await program.parseAsync(['node', 'jvmsrc', 'diagnostics', 'last'], { from: 'node' });
  } finally {
    console.log = prevLog;
  }

  expect(lines.length).toBe(1);
  expect(lines[0]).toContain('new message');
  expect(lines[0]).toContain('22222222');
});

test('diagnostics last N prints N records', async () => {
  appendCurrentLog([
    JSON.stringify({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      timestamp: '2026-01-03T00:00:00.000Z',
      severity: 'resolver_fail',
      toolVersion: '0.0.0',
      operation: 'op3',
      input: {},
      message: 'msg-3',
      errorCode: 'E3',
      stack: null,
      context: {
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20',
        javaVersion: null,
        gradleVersion: null,
        projectRoot: '/tmp/c',
        buildSystem: 'gradle',
        cacheDir: '/tmp/cache',
      },
    }),
    JSON.stringify({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      timestamp: '2026-01-04T00:00:00.000Z',
      severity: 'resolver_fail',
      toolVersion: '0.0.0',
      operation: 'op4',
      input: {},
      message: 'msg-4',
      errorCode: 'E4',
      stack: null,
      context: {
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20',
        javaVersion: null,
        gradleVersion: null,
        projectRoot: '/tmp/d',
        buildSystem: 'gradle',
        cacheDir: '/tmp/cache',
      },
    }),
  ]);

  const program = new Command();
  registerDiagnosticsCli(program);

  const lines: string[] = [];
  const prevLog = console.log;
  console.log = (msg?: unknown) => {
    lines.push(String(msg ?? ''));
  };
  try {
    await program.parseAsync(['node', 'jvmsrc', 'diagnostics', 'last', '2'], { from: 'node' });
  } finally {
    console.log = prevLog;
  }

  expect(lines.length).toBe(2);
  expect(lines[0]).toContain('msg-4');
  expect(lines[1]).toContain('msg-3');
});
