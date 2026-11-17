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

describe('applySourceExcerpt on non-Java source', () => {
  const kt = 'package q\n\nclass Box {\n  fun getName() = "n"\n}\n';

  test('shouldExplainJavaOnlyWhenMethodNamesAreRequestedForKotlin', () => {
    const r = applySourceExcerpt(kt, 'q.Box', true, { methodNames: ['getName'] }, 'kotlin');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('EXCERPT_REQUEST_INVALID');
      expect(r.error.message).toBe('method excerpts are Java-only for kotlin source; use startLine/endLine.');
    }
  });

  test('shouldExplainJavaOnlyWhenMethodNamesAndLinesAreMixedForKotlin', () => {
    const r = applySourceExcerpt(kt, 'q.Box', true, { methodNames: ['getName'], startLine: 3, endLine: 4 }, 'kotlin');
    expect(r.ok).toBe(false);
  });

  test('shouldSliceLinesWhenOnlyARangeIsRequestedForKotlin', () => {
    const r = applySourceExcerpt(kt, 'q.Box', true, { startLine: 3, endLine: 4 }, 'kotlin');
    expect(r.ok).toBe(true);
    if (r.ok && r.excerpt) {
      expect(r.source.trimEnd()).toBe('class Box {\n  fun getName() = "n"');
    }
  });

  test('shouldKeepJavaBehaviourWhenLanguageIsOmitted', () => {
    const r = applySourceExcerpt(boxSource, 'q.Box', true, { methodNames: ['getName'] });
    expect(r.ok).toBe(true);
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

describe('applySourceExcerpt constructor alias and hints', () => {
  const src = `package q;
public class Foo {
  public Foo(int x) {}
  public void alpha() {}
  public void beta() {}
}
`;

  test('shouldMatchConstructorWhenSimpleClassNameRequested', () => {
    const r = applySourceExcerpt(src, 'q.Foo', true, { methodNames: ['Foo'] });
    expect(r.ok).toBe(true);
    if (r.ok && r.excerpt) {
      expect(r.excerpt.matchedMethodNames).toEqual(['Foo']);
      expect(r.source).toContain('public Foo(int x)');
    }
  });

  test('shouldListDeclaredMethodNamesWhenNoMethodMatches', () => {
    const r = applySourceExcerpt(src, 'q.Foo', true, { methodNames: ['gamma'] });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === 'EXCERPT_NOT_FOUND') {
      expect(r.error.message).toContain('Declared methods: <init>, alpha, beta');
    }
  });
});

describe('applySourceExcerpt nested type', () => {
  const src = `package com.google.common.collect;
public class ImmutableList {
  void outerOnly() {}
  public static final class Builder {
    public ImmutableList build(int expectedSize) { return null; }
  }
}
`;

  test('methodNames build returns the nested method from the enclosing file', () => {
    const r = applySourceExcerpt(src, 'com.google.common.collect.ImmutableList$Builder', true, {
      methodNames: ['build'],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.excerpt) {
      expect(r.source).toContain('build(int expectedSize)');
      expect(r.source).not.toContain('outerOnly');
      expect(r.excerpt.matchedMethodNames).toEqual(['build']);
      expect(r.excerpt.lineNumbersReliable).toBe(true);
    }
  });
});
