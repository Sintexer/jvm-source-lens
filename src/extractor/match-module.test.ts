import { describe, expect, test } from 'bun:test';
import type { ResolvedModule } from '../resolvers/resolution-output.js';
import { inferIncludeTest, isAllModules, matchModule, normalizeModulePath, withoutAllModules } from './match-module.js';

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

describe('inferIncludeTest', () => {
  test.each([
    ['/p/app/src/test/java/com/x/FooTest.java', true],
    ['app/src/test/java/com/x/FooTest.java', true],
    ['src/test/kotlin/FooTest.kt', true],
    ['C:\\p\\app\\src\\test\\java\\FooTest.java', true],
    ['/p/app/src/test', true],
    ['/p/app/src/main/java/com/x/Foo.java', undefined],
    ['/p/app/src/testFixtures/java/Foo.java', true],
    ['src/jvmTest/kotlin/X.kt', true],
    ['/p/app/src/integrationTest/java/X.java', true],
    ['/p/app/src/jvmTest', true],
    ['C:\\p\\app\\src\\jvmTest\\kotlin\\X.kt', true],
    ['/p/app/src/jvmMain/kotlin/X.kt', undefined],
    ['/p/app/src/testing/X.java', undefined],
    ['/p/mytest/src/main/Foo.java', undefined],
    [':app', undefined],
    [undefined, undefined],
  ])('modulePath %p → %p', (modulePath, expected) => {
    expect(inferIncludeTest(modulePath, undefined)).toBe(expected);
  });

  test('an explicit includeTest wins over the path', () => {
    expect(inferIncludeTest('/p/app/src/test/java/FooTest.java', false)).toBe(false);
    expect(inferIncludeTest('/p/app/src/main/java/Foo.java', true)).toBe(true);
  });
});

describe('Maven reactor module matching', () => {
  // Root folder itself is named `app`, while submodule `acme-app` lives at `services/app`.
  const mavenRoot = '/work/app';
  const mavenMods = [
    mod('acme-parent', mavenRoot),
    mod('acme-core', `${mavenRoot}/core`),
    mod('acme-api', `${mavenRoot}/services/api`),
    mod('acme-app', `${mavenRoot}/services/app`),
  ];
  const pick = (raw: string) => {
    const m = matchModule(raw, mavenMods, mavenRoot);
    return m.kind === 'match' ? m.module.name : m.kind === 'ambiguous' ? m.candidates : null;
  };

  test('matches artifactId, colon-prefixed artifactId, and case-insensitive artifactId', () => {
    expect(pick('acme-api')).toBe('acme-api');
    expect(pick(':acme-api')).toBe('acme-api');
    expect(pick('ACME-API')).toBe('acme-api');
  });

  test('matches relative directory and bare directory basename without colliding with root folder name', () => {
    expect(pick('services/api')).toBe('acme-api');
    expect(pick('api')).toBe('acme-api');
    expect(pick('core')).toBe('acme-core');
    expect(pick('app')).toBe('acme-app');
  });

  test('maps root aliases (:, ., root) and root-only files to the reactor root module', () => {
    expect(pick(':')).toBe('acme-parent');
    expect(pick('.')).toBe('acme-parent');
    expect(pick('root')).toBe('acme-parent');
    expect(pick('pom.xml/')).toBe('acme-parent');
  });

  test('maps submodule file paths to owning Maven module', () => {
    expect(pick('services/api/src/test/java/com/acme/ApiTest.java')).toBe('acme-api');
    expect(pick(`${mavenRoot}/core/src/main/kotlin/com/acme/Core.kt`)).toBe('acme-core');
  });
});

describe('matchModule with Maven groupId:artifactId names', () => {
  const mvn = [
    mod('app', '/p'),
    mod('com.a:core', '/p/a/core'),
    mod('com.b:core', '/p/b/core'),
    mod('web', '/p/web'),
  ];

  test('shouldMatchExactlyWhenGivenTheQualifiedName', () => {
    const r = matchModule('com.a:core', mvn, '/p');
    expect(r.kind === 'match' && r.module.path).toBe('/p/a/core');
  });

  test('shouldMatchWhenGivenTheQualifiedNameWithLeadingColon', () => {
    const r = matchModule(':com.b:core', mvn, '/p');
    expect(r.kind === 'match' && r.module.path).toBe('/p/b/core');
  });

  test('shouldBeAmbiguousWithUniqueCandidatesWhenGivenTheSharedArtifactId', () => {
    const r = matchModule('core', mvn, '/p');
    expect(r).toEqual({ kind: 'ambiguous', candidates: ['com.a:core', 'com.b:core'] });
  });

  test('shouldMatchByDirectoryPathWhenGivenAFilePathInOneModule', () => {
    const r = matchModule('/p/b/core/src/main/java/X.java', mvn, '/p');
    expect(r.kind === 'match' && r.module.name).toBe('com.b:core');
  });
});

