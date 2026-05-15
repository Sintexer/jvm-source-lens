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
