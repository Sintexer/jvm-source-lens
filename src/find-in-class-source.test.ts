import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ClassSourceLookupResult } from './extractor/class-source-types.js';
import { searchExtractedSource } from './find-in-class-source.js';

function extracted(source: string): Extract<ClassSourceLookupResult, { ok: true }> {
  return {
    ok: true,
    source,
    sourceAvailable: true,
    className: 'com.example.Evil',
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
});
