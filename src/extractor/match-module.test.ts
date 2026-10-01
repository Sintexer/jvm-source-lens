import { describe, expect, test } from 'bun:test';
import type { ResolvedModule } from '../resolvers/resolution-output.js';
import { matchModule, normalizeModulePath } from './match-module.js';

const mod = (name: string, path: string): ResolvedModule => ({ name, path, configurations: [] });

const modules = [
  mod('root', '/p'),
  mod(':app', '/p/app'),
  mod(':libs:core', '/p/libs/core'),
  mod(':libs:util', '/p/libs/util'),
  mod(':tools:util', '/p/tools/util'),
];

describe('normalizeModulePath', () => {
  test.each([
    ['app', ':app'],
    ['/app', ':app'],
    ['app/', ':app'],
    [':app:', ':app'],
    ['libs/core', ':libs:core'],
    ['libs\\core', ':libs:core'],
    ['./libs/core', ':libs:core'],
    ['', ':'],
    [':', ':'],
    ['.', ':'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeModulePath(raw)).toBe(expected);
  });
});

describe('matchModule', () => {
  const name = (raw: string) => {
    const m = matchModule(raw, modules);
    return m.kind === 'match' ? m.module.name : m.kind === 'ambiguous' ? m.candidates : null;
  };

  test('exact and loosely written Gradle paths', () => {
    expect(name(':app')).toBe(':app');
    expect(name('app')).toBe(':app');
    expect(name('/app/')).toBe(':app');
    expect(name('libs/core')).toBe(':libs:core');
  });

  test('case-insensitive', () => {
    expect(name('APP')).toBe(':app');
  });

  test('root aliases', () => {
    expect(name('root')).toBe('root');
    expect(name(':')).toBe('root');
    expect(name('.')).toBe('root');
  });

  test('unique directory-name match', () => {
    expect(name('core')).toBe(':libs:core');
  });

  test('ambiguous directory name lists candidates', () => {
    expect(name('util')).toEqual([':libs:util', ':tools:util']);
    expect(name('libs/util')).toBe(':libs:util');
  });

  test('matches by filesystem path when Gradle path differs', () => {
    const m = matchModule('services/api', [mod('root', '/p'), mod(':api', '/p/services/api')]);
    expect(m.kind === 'match' && m.module.name).toBe(':api');
  });

  test('no match', () => {
    expect(matchModule('nope', modules).kind).toBe('none');
  });
});
