import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildLineIndex,
  searchClassSourceText,
  searchClassSourceTextAsync,
} from './class-source-text-search.js';
import { RegexMatchRunner } from './regex-match-runner.js';

const sample = `package q;

public class Box {
  public String getName() {
    return "needle";
  }

  public void logNeedle() {
    throw new IllegalStateException("needle in haystack");
  }
}
`;

describe('searchClassSourceText', () => {
  test('literal match with context', () => {
    const r = searchClassSourceText(sample, { query: 'needle', contextLines: 1, maxHits: 5 });
    expect('error' in r).toBe(false);
    if ('error' in r) {
      return;
    }
    expect(r.totalMatches).toBeGreaterThanOrEqual(2);
    expect(r.hits[0]!.matchedText).toBe('needle');
    expect(r.hits[0]!.line).toBeGreaterThan(0);
    expect(r.hits[0]!.contextBefore.length).toBeLessThanOrEqual(1);
  });

  test('multiline block when match spans lines', () => {
    const multi = 'line1\nline2needle\nline3';
    const r = searchClassSourceText(multi, { query: 'line2needle\nline3', contextLines: 0 });
    expect('error' in r).toBe(false);
    if ('error' in r) {
      return;
    }
    expect(r.hits[0]!.block).toEqual({ startLine: 2, endLine: 3 });
  });

  test('regex mode', () => {
    const r = searchClassSourceText(sample, { query: 'throw new \\w+', regex: true, maxHits: 1 });
    expect('error' in r).toBe(false);
    if ('error' in r) {
      return;
    }
    expect(r.hits[0]!.matchedText).toContain('throw new');
  });

  test('invalid regex', () => {
    const r = searchClassSourceText(sample, { query: '(', regex: true });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('FIND_QUERY_INVALID');
    }
  });

  test('empty query rejected', () => {
    const r = searchClassSourceText(sample, { query: '' });
    expect('error' in r).toBe(true);
  });

  test('truncates at maxHits', () => {
    const r = searchClassSourceText('aaa', { query: 'a', maxHits: 2 });
    expect('error' in r).toBe(false);
    if ('error' in r) {
      return;
    }
    expect(r.hits.length).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.totalMatches).toBe(3);
  });
});

describe('searchClassSourceTextAsync', () => {
  let savedTimeout: string | undefined;

  beforeEach(() => {
    savedTimeout = process.env.JVMSRC_REGEX_TIMEOUT_MS;
  });

  afterEach(() => {
    if (savedTimeout === undefined) {
      delete process.env.JVMSRC_REGEX_TIMEOUT_MS;
    } else {
      process.env.JVMSRC_REGEX_TIMEOUT_MS = savedTimeout;
    }
  });

  test('regex mode returns the same hits as the sync search', async () => {
    const opts = { query: 'needle|throw new \\w+', regex: true, contextLines: 1, maxHits: 5 };

    const r = await searchClassSourceTextAsync(sample, opts);

    expect(r).toEqual(searchClassSourceText(sample, opts));
    if (!('error' in r)) {
      expect(r.hits.length).toBeGreaterThan(1);
    }
  });

  test('literal mode does not need a worker', async () => {
    const r = await searchClassSourceTextAsync('aaa', { query: 'a', maxHits: 2 });
    expect(r).toEqual(searchClassSourceText('aaa', { query: 'a', maxHits: 2 }));
  });

  test('invalid regex returns FIND_QUERY_INVALID', async () => {
    const r = await searchClassSourceTextAsync(sample, { query: '(', regex: true });
    expect('error' in r && r.error.code).toBe('FIND_QUERY_INVALID');
  });

  test('zero-length matches are skipped', async () => {
    const r = await searchClassSourceTextAsync('ab', { query: 'x*', regex: true });
    expect(r).toEqual({ hits: [], totalMatches: 0, truncated: false });
  });

  test('regex truncates at maxHits', async () => {
    const r = await searchClassSourceTextAsync('aaa', { query: 'a', regex: true, maxHits: 2 });
    expect('error' in r).toBe(false);
    if ('error' in r) {
      return;
    }
    expect(r.hits.length).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.totalMatches).toBe(3);
  });

  test('shouldReturnFindQueryInvalidWhenRegexBacktracksPastDeadline', async () => {
    process.env.JVMSRC_REGEX_TIMEOUT_MS = '200';
    const started = Date.now();

    const r = await searchClassSourceTextAsync('a'.repeat(40) + '!', { query: '(a+)+$', regex: true });

    expect(Date.now() - started).toBeLessThan(1500);
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('FIND_QUERY_INVALID');
      expect(r.error.message).toContain('timed out');
      expect(r.error.message).toContain('JVMSRC_REGEX_TIMEOUT_MS');
    }
  });

  test('a shared runner recovers after a timeout', async () => {
    const runner = new RegexMatchRunner(200);
    try {
      const slow = await searchClassSourceTextAsync('a'.repeat(40) + '!', { query: '(a+)+$', regex: true }, runner);
      expect('error' in slow).toBe(true);

      const fast = await searchClassSourceTextAsync(sample, { query: 'needle', regex: true }, runner);
      expect('error' in fast).toBe(false);
    } finally {
      await runner.close();
    }
  });
});

describe('buildLineIndex', () => {
  test('maps CRLF offsets', () => {
    const src = 'a\r\nb';
    const { lines, lineStarts } = buildLineIndex(src);
    expect(lines).toEqual(['a', 'b']);
    expect(lineStarts).toEqual([0, 3]);
  });
});
