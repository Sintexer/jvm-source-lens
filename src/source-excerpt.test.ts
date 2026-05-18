import { describe, expect, test } from 'bun:test';
import { collectMethodSourceSpans } from './class-structure/parse-java-type-metadata.js';
import { applySourceExcerpt, mergeSourceExcerptInputs } from './source-excerpt.js';

const boxSource = `
package q;

public class Box {
  private final String name;

  public Box(String name) {
    this.name = name;
  }

  public String getName() {
    return name;
  }

  public static Box empty() {
    return new Box("");
  }
}
`;

describe('mergeSourceExcerptInputs', () => {
  test('merges methodName and methodNames without duplicates', () => {
    expect(mergeSourceExcerptInputs(['getName', 'empty'], 'getName')).toEqual(['getName', 'empty']);
  });
});

describe('collectMethodSourceSpans', () => {
  test('records constructor and methods', () => {
    const spans = collectMethodSourceSpans(boxSource, 'q.Box');
    expect(spans).not.toBeNull();
    const names = spans!.map((s) => s.jvmMethodName).sort();
    expect(names).toEqual(['<init>', 'empty', 'getName']);
    for (const s of spans!) {
      expect(boxSource.slice(s.start, s.end)).toContain(s.jvmMethodName === '<init>' ? 'Box(' : `${s.jvmMethodName}`);
    }
  });
});

describe('applySourceExcerpt', () => {
  test('returns full source when no excerpt requested', () => {
    const r = applySourceExcerpt(boxSource, 'q.Box', true, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(boxSource);
      expect(r.excerpt).toBeUndefined();
    }
  });

  test('extracts multiple methods', () => {
    const r = applySourceExcerpt(boxSource, 'q.Box', true, { methodNames: ['getName', 'empty'] });
    expect(r.ok).toBe(true);
    if (r.ok && r.excerpt) {
      expect(r.source).toContain('getName');
      expect(r.source).toContain('empty');
      expect(r.source).not.toContain('private final String name');
      expect(r.excerpt.matchedMethodNames.sort()).toEqual(['empty', 'getName']);
      expect(r.excerpt.unmatchedMethodNames).toEqual([]);
    }
  });

  test('fails when no methods match', () => {
    const r = applySourceExcerpt(boxSource, 'q.Box', true, { methodNames: ['missing'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('EXCERPT_NOT_FOUND');
    }
  });

  test('line range excerpt', () => {
    const r = applySourceExcerpt(boxSource, 'q.Box', true, { startLine: 4, endLine: 6 });
    expect(r.ok).toBe(true);
    if (r.ok && r.excerpt) {
      expect(r.source).toContain('private final String name');
      expect(r.excerpt.startLine).toBe(4);
    }
  });

  test('decompiled marks lineNumbersReliable false', () => {
    const r = applySourceExcerpt(boxSource, 'q.Box', false, { methodNames: ['getName'] });
    expect(r.ok).toBe(true);
    if (r.ok && r.excerpt) {
      expect(r.excerpt.lineNumbersReliable).toBe(false);
    }
  });
});
