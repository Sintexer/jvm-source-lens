import { describe, expect, test } from 'bun:test';
import type { ResolvedModule } from '../resolvers/resolution-output.js';
import { isAllModules, matchModule, normalizeModulePath, withoutAllModules } from './match-module.js';

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

describe('all-modules spelling', () => {
  test.each(['*', 'all', ' ALL ', ' * '])('%j means no module restriction', (raw) => {
    expect(isAllModules(raw)).toBe(true);
    const out = withoutAllModules({ modulePath: raw as string | undefined, includeTest: true });
    expect(out.modulePath).toBeUndefined();
    expect(out.includeTest).toBe(true);
  });
  test.each(['', ':app', 'allocator', 'root'])('%j is a real module', (raw) => {
    expect(isAllModules(raw)).toBe(false);
  });
  test('absent modulePath is not an all-modules spelling', () => {
    expect(isAllModules(undefined)).toBe(false);
  });
});

describe('files and directories inside a module', () => {
  const root = '/work/proj';
  const mods = [
    mod('root', root),
    mod(':app', `${root}/app`),
    mod(':libs:core', `${root}/libs/core`),
    mod(':libs:core:api', `${root}/libs/core/api`),
  ];
  const name = (raw: string) => {
    const m = matchModule(raw, mods, root);
    return m.kind === 'match' ? m.module.name : m.kind;
  };

  test('absolute source file path → its module', () => {
    expect(name(`${root}/app/src/main/java/com/acme/Foo.java`)).toBe(':app');
  });

  test('project-relative source file path → its module', () => {
    expect(name('app/src/main/java/com/acme/Foo.java')).toBe(':app');
    expect(name('libs/core/src/test/java/X.kt')).toBe(':libs:core');
  });

  test('directories work too, and the longest (deepest) module wins', () => {
    expect(name(`${root}/app/src/main`)).toBe(':app');
    expect(name('libs/core/api/src/main/java/A.java')).toBe(':libs:core:api');
    expect(name('libs/core/src/main/java/A.java')).toBe(':libs:core');
  });

  test('a file in the root project outside every submodule → root', () => {
    expect(name(`${root}/src/main/java/Main.java`)).toBe('root');
    expect(name('build.gradle/')).toBe('root');
  });

  test('Gradle-style input is unaffected', () => {
    expect(name(':app')).toBe(':app');
    expect(name('app')).toBe(':app');
    expect(name('libs/core')).toBe(':libs:core');
    expect(name('/app')).toBe(':app'); // not a path inside the project: stays a Gradle path
  });

  test('relative paths need a project root; absolute ones do not', () => {
    expect(matchModule('app/src/X.java', mods).kind).not.toBe('match');
    const abs = matchModule(`${root}/app/src/X.java`, mods);
    expect(abs.kind === 'match' && abs.module.name).toBe(':app');
  });

  test('paths outside the project do not match', () => {
    expect(name('/elsewhere/other/src/X.java')).toBe('none');
  });

  test('a sibling directory with a shared name prefix is not inside the module', () => {
    expect(name(`${root}/app-extra/src/X.java`)).toBe('root');
  });
});
