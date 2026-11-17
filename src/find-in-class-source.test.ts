import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ClassSourceLookupResult } from './extractor/class-source-types.js';
import { searchExtractedSource } from './find-in-class-source.js';

const NESTED = `package com.example;
public class Outer {
  void outerOnly() { int ONLY_OUTER = 1; }
  public static class Builder {
    public void build() { int ONLY_BUILD = 2; }
  }
}
`;

function extracted(source: string, className = 'com.example.Evil'): Extract<ClassSourceLookupResult, { ok: true }> {
  return {
    ok: true,
    source,
    sourceAvailable: true,
    sourceLanguage: 'java',
    className,
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'com.example', name: 'lib', version: '1.0' },
      jarPath: '/tmp/lib-1.0-sources.jar',
    },
  };
}

describe('searchExtractedSource', () => {
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

  test('shouldReturnFindQueryInvalidWhenRegexTimesOut', async () => {
    process.env.JVMSRC_REGEX_TIMEOUT_MS = '200';

    const r = await searchExtractedSource(extracted('a'.repeat(40) + '!'), { query: '(a+)+$', regex: true });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('FIND_QUERY_INVALID');
      expect(r.error.message).toContain('timed out');
    }
  });

  test('shouldReturnHitsWhenRegexMatches', async () => {
    const r = await searchExtractedSource(extracted('class Evil { int x = 42; }'), { query: '\\d+', regex: true });

    expect(r).toMatchObject({ ok: true, found: true, regex: true, hitCount: 1 });
  });

  test('searches the nested declaration and reports file lines', async () => {
    const nested = extracted(NESTED, 'com.example.Outer$Builder');
    const outerOnly = await searchExtractedSource(nested, { query: 'ONLY_OUTER', contextLines: 0 });
    expect(outerOnly).toMatchObject({ ok: true, found: false });

    const build = await searchExtractedSource(nested, { query: 'ONLY_BUILD', contextLines: 0 });
    expect(build.ok && build.found).toBe(true);
    if (build.ok && build.found) {
      const fileLine = NESTED.slice(0, NESTED.indexOf('ONLY_BUILD')).split('\n').length;
      expect(build.hits[0]!.line).toBe(fileLine);
    }
  });

  test('shouldSearchOnlyTheNestedKotlinDeclarationAndReportFileLines', async () => {
    const kt = 'package com.example\n\nclass Outer {\n  class Inner {\n    fun inside() = 1\n  }\n  fun outerOnly() = 2\n}\n';
    const nested = { ...extracted(kt, 'com.example.Outer$Inner'), sourceLanguage: 'kotlin' as const };
    const outer = await searchExtractedSource(nested, { query: 'outerOnly', contextLines: 0 });
    expect(outer).toMatchObject({ ok: true, found: false });
    const inside = await searchExtractedSource(nested, { query: 'inside', contextLines: 0 });
    expect(inside.ok && inside.found).toBe(true);
    if (inside.ok && inside.found) {
      expect(inside.hits[0]!.line).toBe(5);
    }
  });

  test('shouldReportKotlinLinesWhenTheNameIsTopLevel', async () => {
    const kt = 'package com.example\n\nfun hello() = "hi"\n';
    const r = await searchExtractedSource(
      { ...extracted(kt, 'com.example.GreetKt'), sourceLanguage: 'kotlin' },
      { query: 'hello', contextLines: 0 },
    );
    expect(r).toMatchObject({ ok: true, found: true, hitCount: 1 });
    if (r.ok && r.found) {
      expect(r.hits[0]!.line).toBe(3);
    }
  });
});
