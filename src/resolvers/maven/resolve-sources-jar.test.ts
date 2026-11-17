import { describe, expect, test } from 'bun:test';
import { parseMavenSourcesJson } from './resolve-sources-jar.js';

describe('parseMavenSourcesJson', () => {
  test('shouldReturnPathWhenAnalyzerFoundSources', () => {
    expect(parseMavenSourcesJson('{"sourcesJarPath":"/m2/a-1-sources.jar"}')).toEqual({
      ok: true,
      sourcesJarPath: '/m2/a-1-sources.jar',
    });
  });

  test('shouldReturnReasonWhenAnalyzerFoundNoSources', () => {
    expect(parseMavenSourcesJson('{"sourcesJarPath":null,"reason":"Could not find artifact g:a:jar:sources:1"}')).toEqual({
      ok: true,
      sourcesJarPath: null,
      reason: 'Could not find artifact g:a:jar:sources:1',
    });
  });

  test('shouldOmitReasonWhenItIsNotAString', () => {
    expect(parseMavenSourcesJson('{"sourcesJarPath":null,"reason":5}')).toEqual({ ok: true, sourcesJarPath: null });
  });

  test('shouldReturnErrorWhenOutputIsNotJson', () => {
    expect(parseMavenSourcesJson('nope').ok).toBe(false);
  });
});
