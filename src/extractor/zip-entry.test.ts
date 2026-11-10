import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { readZipEntryUtf8, zipEntryExists } from './zip-entry.js';

describe('zip-entry', () => {
  let dir: string;
  let jarPath: string;
  let savedLimit: string | undefined;

  beforeEach(() => {
    savedLimit = process.env.JVMSRC_MAX_JAR_BYTES;
    dir = mkdtempSync(join(tmpdir(), 'jvmsrc-zip-entry-'));
    jarPath = join(dir, 'sample.jar');
    writeFileSync(
      jarPath,
      zipSync({ 'com/x/Foo.java': new TextEncoder().encode('class Foo {}') }),
    );
  });

  afterEach(() => {
    if (savedLimit === undefined) {
      delete process.env.JVMSRC_MAX_JAR_BYTES;
    } else {
      process.env.JVMSRC_MAX_JAR_BYTES = savedLimit;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads an entry when the archive is under the size limit', () => {
    const r = readZipEntryUtf8(jarPath, 'com/x/Foo.java');
    expect(r).toEqual({ ok: true, text: 'class Foo {}' });
    expect(zipEntryExists(jarPath, 'com/x/Foo.java')).toEqual({ ok: true, exists: true });
  });

  test('readZipEntryUtf8 returns ZIP_READ_ERROR with size and limit when the archive is too large', () => {
    process.env.JVMSRC_MAX_JAR_BYTES = '16';
    const size = statSync(jarPath).size;

    const r = readZipEntryUtf8(jarPath, 'com/x/Foo.java');

    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'error') {
      expect(r.error.code).toBe('ZIP_READ_ERROR');
      expect(r.error.message).toContain(String(size));
      expect(r.error.message).toContain('16');
      expect(r.error.message).toContain('JVMSRC_MAX_JAR_BYTES');
    } else {
      throw new Error('expected an error result');
    }
  });

  test('zipEntryExists returns ZIP_READ_ERROR when the archive is too large', () => {
    process.env.JVMSRC_MAX_JAR_BYTES = '16';

    const r = zipEntryExists(jarPath, 'com/x/Foo.java');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ZIP_READ_ERROR');
      expect(r.error.message).toContain('JVMSRC_MAX_JAR_BYTES');
    }
  });
});
