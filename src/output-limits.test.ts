import { expect, test } from 'bun:test';
import {
  capSourceText,
  checkUnscopedFullSourceSize,
  DEFAULT_MAX_FULL_SOURCE_CHARS,
  DEFAULT_MAX_SOURCE_OUTPUT_CHARS,
} from './output-limits.js';

test('capSourceText leaves short text unchanged', () => {
  const r = capSourceText('hello', 100);
  expect(r.truncated).toBe(false);
  expect(r.text).toBe('hello');
  expect(r.originalLength).toBe(5);
});

test('capSourceText truncates with marker', () => {
  const r = capSourceText('x'.repeat(200), 50);
  expect(r.truncated).toBe(true);
  expect(r.originalLength).toBe(200);
  expect(r.text).toContain('jvmsrc: output truncated');
  expect(r.text.length).toBeLessThanOrEqual(50);
});

test('DEFAULT_MAX_SOURCE_OUTPUT_CHARS is positive', () => {
  expect(DEFAULT_MAX_SOURCE_OUTPUT_CHARS).toBeGreaterThan(1024);
});

test('DEFAULT_MAX_FULL_SOURCE_CHARS is below soft truncation cap', () => {
  expect(DEFAULT_MAX_FULL_SOURCE_CHARS).toBeLessThan(DEFAULT_MAX_SOURCE_OUTPUT_CHARS);
  expect(DEFAULT_MAX_FULL_SOURCE_CHARS).toBe(64 * 1024);
});

test('checkUnscopedFullSourceSize accepts small sources', () => {
  expect(checkUnscopedFullSourceSize('a.B', 'class B {}').ok).toBe(true);
});

test('checkUnscopedFullSourceSize refuses oversized unscoped source', () => {
  const prev = process.env.JVMSRC_MAX_FULL_SOURCE_CHARS;
  process.env.JVMSRC_MAX_FULL_SOURCE_CHARS = '100';
  try {
    const r = checkUnscopedFullSourceSize('a.Huge', 'x'.repeat(101));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.charLength).toBe(101);
      expect(r.maxChars).toBe(100);
      expect(r.message).toContain('methodNames');
    }
  } finally {
    if (prev === undefined) {
      delete process.env.JVMSRC_MAX_FULL_SOURCE_CHARS;
    } else {
      process.env.JVMSRC_MAX_FULL_SOURCE_CHARS = prev;
    }
  }
});
