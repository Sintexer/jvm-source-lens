import { expect, test } from 'bun:test';
import { capSourceText, DEFAULT_MAX_SOURCE_OUTPUT_CHARS } from './output-limits.js';

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
