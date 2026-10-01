import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CALL_LOG_FILE_NAME, summarizeToolResult, withCallLog } from './call-log.js';

describe('withCallLog', () => {
  let dir: string;
  const saved = { log: process.env.JVMSRC_CALL_LOG, dir: process.env.JVMSRC_LOG_DIR };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-calllog-'));
    process.env.JVMSRC_LOG_DIR = dir;
  });
  afterEach(() => {
    for (const [k, v] of [['JVMSRC_CALL_LOG', saved.log], ['JVMSRC_LOG_DIR', saved.dir]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readLines = () =>
    fs
      .readFileSync(path.join(dir, CALL_LOG_FILE_NAME), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  test('writes nothing when disabled', async () => {
    delete process.env.JVMSRC_CALL_LOG;
    const wrapped = withCallLog('t', async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    await wrapped({}, undefined as never);
    expect(fs.existsSync(path.join(dir, CALL_LOG_FILE_NAME))).toBe(false);
  });

  test('logs sanitized input, outcome and first-call flag when enabled', async () => {
    process.env.JVMSRC_CALL_LOG = '1';
    const wrapped = withCallLog('get_class_structure', async () => ({
      isError: true,
      content: [{ type: 'text' as const, text: 'boom' }],
      structuredContent: { code: 'MODULE_NOT_FOUND', errorCategory: 'USER_INPUT' },
    }));
    await wrapped({ projectRoot: '/p', className: 'a.B', secret: 'x', nested: { a: 1 } }, undefined as never);
    await wrapped({ projectRoot: '/p' }, undefined as never);
    const [first, second] = readLines();
    expect(first).toMatchObject({
      tool: 'get_class_structure',
      isError: true,
      code: 'MODULE_NOT_FOUND',
      errorCategory: 'USER_INPUT',
      textChars: 4,
      input: { projectRoot: '/p', className: 'a.B' },
    });
    expect(first!.input).not.toHaveProperty('secret');
    expect(second!.seq).toBe((first!.seq as number) + 1);
    expect(second!.firstCallOfSession).toBe(false);
  });

  test('records a thrown handler and rethrows', async () => {
    process.env.JVMSRC_CALL_LOG = 'true';
    const wrapped = withCallLog('t', async () => {
      throw new Error('x');
    });
    await expect(wrapped({}, undefined as never)).rejects.toThrow('x');
    expect(readLines()[0]).toMatchObject({ isError: true, code: 'THROWN' });
  });
});

test('summarizeToolResult handles compact success', () => {
  expect(summarizeToolResult({ content: [{ type: 'text', text: 'abc' }] })).toEqual({
    isError: false,
    errorCategory: null,
    code: null,
    textChars: 3,
  });
});
