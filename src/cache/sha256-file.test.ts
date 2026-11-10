import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256File } from './sha256-file.js';

describe('sha256File', () => {
  test('matches a whole-buffer hash for content larger than one chunk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jvmsrc-sha-'));
    try {
      const p = join(dir, 'big.bin');
      const buf = Buffer.alloc(3 * 1024 * 1024 + 17);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = i % 251;
      }
      writeFileSync(p, buf);

      expect(sha256File(p)).toBe(createHash('sha256').update(buf).digest('hex'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws when the file is missing', () => {
    expect(() => sha256File(join(tmpdir(), 'jvmsrc-missing-file.bin'))).toThrow();
  });
});
