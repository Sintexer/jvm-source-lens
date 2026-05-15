import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getDecompiledCacheFilePath,
  isPathWithinDecompiledCache,
  readDecompiledCacheFile,
  sanitizeCacheSegment,
  validateCacheSegment,
  writeDecompiledCacheFile,
} from './decompiled-paths.js';

let prevJvmsrcCacheRoot: string | undefined;
let testCacheRoot: string;

function isolateCacheEnv(): void {
  testCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-decompiled-'));
  prevJvmsrcCacheRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = testCacheRoot;
}

function restoreCacheEnv(): void {
  if (prevJvmsrcCacheRoot === undefined) {
    delete process.env.JVMSRC_CACHE_ROOT;
  } else {
    process.env.JVMSRC_CACHE_ROOT = prevJvmsrcCacheRoot;
  }
  try {
    fs.rmSync(testCacheRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe('sanitizeCacheSegment', () => {
  test('replaces path separators', () => {
    expect(sanitizeCacheSegment('com/evil')).toBe('com_evil');
    expect(sanitizeCacheSegment('a\\b')).toBe('a_b');
  });
});

describe('validateCacheSegment', () => {
  test('rejects .. segment', () => {
    expect(validateCacheSegment('group', '..').ok).toBe(false);
    expect(validateCacheSegment('group', 'com..evil').ok).toBe(false);
  });

  test('rejects empty segment', () => {
    expect(validateCacheSegment('artifact', '   ').ok).toBe(false);
  });
});

describe('getDecompiledCacheFilePath', () => {
  beforeEach(isolateCacheEnv);
  afterEach(restoreCacheEnv);

  test('builds path with unknown version when null', () => {
    const r = getDecompiledCacheFilePath(
      { group: 'com.example', name: 'lib', version: null },
      'com.example.Foo',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cachePath).toBe(
        path.join(testCacheRoot, 'decompiled', 'com.example', 'lib', 'unknown', 'Foo.java'),
      );
    }
  });

  test('rejects parent-segment group', () => {
    const r = getDecompiledCacheFilePath(
      { group: '..', name: 'lib', version: '1' },
      'com.example.Foo',
    );
    expect(r.ok).toBe(false);
  });

  test('cache path stays under decompiled root', () => {
    const r = getDecompiledCacheFilePath(
      { group: 'com.example', name: 'lib', version: '1' },
      'com.example.Foo',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cachePath.startsWith(path.join(testCacheRoot, 'decompiled') + path.sep)).toBe(true);
      expect(isPathWithinDecompiledCache(r.cachePath)).toBe(true);
      expect(isPathWithinDecompiledCache('/etc/passwd')).toBe(false);
    }
  });

  test('uses simple name with inner class dollar', () => {
    const r = getDecompiledCacheFilePath(
      { group: 'g', name: 'a', version: '1' },
      'com.example.Outer$Inner',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cachePath.endsWith(path.join('1', 'Outer$Inner.java'))).toBe(true);
    }
  });
});

describe('readDecompiledCacheFile / writeDecompiledCacheFile', () => {
  beforeEach(isolateCacheEnv);
  afterEach(restoreCacheEnv);

  test('round-trips via atomic write', () => {
    const r = getDecompiledCacheFilePath(
      { group: 'g', name: 'a', version: '1' },
      'com.example.Foo',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(readDecompiledCacheFile(r.cachePath)).toBe(null);
    writeDecompiledCacheFile(r.cachePath, 'decompiled body');
    expect(readDecompiledCacheFile(r.cachePath)).toBe('decompiled body');
  });

  test('refuses read/write outside decompiled root', () => {
    const outside = path.join(testCacheRoot, 'evil.java');
    writeDecompiledCacheFile(path.join(testCacheRoot, 'decompiled', 'g', 'a', '1', 'Foo.java'), 'ok');
    expect(() => writeDecompiledCacheFile(outside, 'nope')).toThrow(/outside decompiled/);
    expect(readDecompiledCacheFile(outside)).toBe(null);
  });
});
