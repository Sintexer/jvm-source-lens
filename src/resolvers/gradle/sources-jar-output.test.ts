import { describe, expect, test } from 'bun:test';
import { parseSourcesJarJson } from './sources-jar-output.js';

describe('parseSourcesJarJson', () => {
  test('parses path', () => {
    const r = parseSourcesJarJson('{"sourcesJarPath":"/tmp/foo-sources.jar"}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.sourcesJarPath).toBe('/tmp/foo-sources.jar');
    }
  });

  test('parses null', () => {
    const r = parseSourcesJarJson('{"sourcesJarPath":null}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.sourcesJarPath).toBeNull();
    }
  });
});

import { withStderrTail } from './resolve-sources-jar.js';

test('shouldAppendLastStderrLinesWhenStderrPresent', () => {
  expect(withStderrTail('Gradle exited with code 1', 'a\n\nb\nc\nd\n')).toBe(
    'Gradle exited with code 1: b | c | d',
  );
});

test('shouldKeepMessageWhenStderrEmpty', () => {
  expect(withStderrTail('Gradle exited with code 1', '')).toBe('Gradle exited with code 1');
});
