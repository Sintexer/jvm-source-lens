import { describe, expect, test } from 'bun:test';
import { buildLineIndex, searchClassSourceText } from './class-source-text-search.js';

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

describe('buildLineIndex', () => {
  test('maps CRLF offsets', () => {
    const src = 'a\r\nb';
    const { lines, lineStarts } = buildLineIndex(src);
    expect(lines).toEqual(['a', 'b']);
    expect(lineStarts).toEqual([0, 3]);
  });
});
