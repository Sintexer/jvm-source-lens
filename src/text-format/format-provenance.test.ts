import { describe, expect, test } from 'bun:test';
import { formatProvenanceLine } from './format-provenance.js';

describe('formatProvenanceLine', () => {
  test('omits absolute jar paths for external kinds', () => {
    expect(
      formatProvenanceLine({
        kind: 'sourcesJar',
        coordinates: { group: 'com.example', name: 'lib', version: '1.0' },
        jarPath: '/Users/me/.gradle/caches/lib-sources.jar',
      }),
    ).toBe('Provenance: com.example:lib:1.0 (sourcesJar)');

    expect(
      formatProvenanceLine({
        kind: 'decompiled',
        coordinates: { group: 'g', name: 'a', version: '2' },
        jarPath: '/tmp/a.jar',
        entryRelPath: 'com/Foo.class',
        cachePath: '/cache/Foo.java',
      }),
    ).toBe('Provenance: g:a:2 (decompiled)');
  });

  test('omits absolute paths for interproject', () => {
    expect(
      formatProvenanceLine({
        kind: 'interproject',
        coordinates: { group: 'p', name: 'm', version: null },
        moduleName: ':core',
        moduleRoot: '/repo/core',
        sourceRelativePath: 'src/main/java/Foo.java',
        absoluteSourcePath: '/repo/core/src/main/java/Foo.java',
      }),
    ).toBe('Provenance: interproject :core');
  });
});
