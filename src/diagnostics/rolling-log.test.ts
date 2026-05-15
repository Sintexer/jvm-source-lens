import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendNdjsonLine } from './rolling-log.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-roll-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('appendNdjsonLine creates current.log with one line', () => {
  appendNdjsonLine(tmp, '{"x":1}');
  const text = fs.readFileSync(path.join(tmp, 'current.log'), 'utf8').trim();
  expect(text).toBe('{"x":1}');
});
