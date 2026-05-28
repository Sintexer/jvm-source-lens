import { describe, expect, test } from 'bun:test';
import {
  deriveLibName,
  projectSearchClassesHit,
  shouldIncludeSearchIndexMeta,
  wantsSearchInclude,
} from './project-search-hit.js';
import type { ClassSearchHit } from './types.js';

const externalHit: ClassSearchHit = {
  className: 'com.acme.Foo',
  simpleName: 'Foo',
  moduleName: 'root',
  configurationName: 'compileClasspath',
  origin: 'external',
  coordinates: { group: 'org.acme', name: 'acme-lib', version: '1.0' },
  jarPath: '/home/.gradle/caches/modules-2/files-2.1/org.acme/acme-lib/1.0/acme-lib-1.0.jar',
  moduleRoot: null,
  interprojectModuleName: null,
  score: 8_000_000,
};

const interprojectHit: ClassSearchHit = {
  ...externalHit,
  origin: 'interproject',
  jarPath: null,
  moduleRoot: '/proj/core',
  interprojectModuleName: ':core',
  coordinates: { group: '', name: '', version: null },
};

const localFileHit: ClassSearchHit = {
  ...externalHit,
  origin: 'local-file',
  coordinates: { group: '', name: '', version: null },
  jarPath: '/proj/libs/custom.jar',
};

describe('deriveLibName', () => {
  test('external uses artifactId', () => {
    expect(deriveLibName(externalHit)).toBe('acme-lib');
  });

  test('interproject uses module name', () => {
    expect(deriveLibName(interprojectHit)).toBe(':core');
  });

  test('local-file falls back to jar basename without .jar', () => {
    expect(deriveLibName(localFileHit)).toBe('custom');
  });
});

describe('projectSearchClassesHit', () => {
  test('default projection is className and libName only', () => {
    expect(projectSearchClassesHit(externalHit)).toEqual({
      className: 'com.acme.Foo',
      libName: 'acme-lib',
    });
  });

  test('include score adds score field', () => {
    const p = projectSearchClassesHit(externalHit, ['score']);
    expect(p.score).toBe(8_000_000);
    expect(p.jarPath).toBeUndefined();
  });

  test('include all expands to full hit fields', () => {
    const p = projectSearchClassesHit(externalHit, ['all']);
    expect(p.simpleName).toBe('Foo');
    expect(p.jarPath).toBe(externalHit.jarPath);
    expect(p.moduleName).toBe('root');
  });
});

describe('wantsSearchInclude', () => {
  test('undefined include is false for optional sections', () => {
    expect(wantsSearchInclude(undefined, 'score')).toBe(false);
  });

  test('all enables any section', () => {
    expect(wantsSearchInclude(['all'], 'location')).toBe(true);
  });
});

describe('shouldIncludeSearchIndexMeta', () => {
  test('default omits index meta', () => {
    expect(shouldIncludeSearchIndexMeta(undefined)).toBe(false);
  });

  test('indexMeta token includes meta', () => {
    expect(shouldIncludeSearchIndexMeta(['indexMeta'])).toBe(true);
  });
});
