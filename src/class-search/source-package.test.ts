import { describe, expect, test } from 'bun:test';
import { packageNameFromSource } from './source-package.js';

describe('packageNameFromSource', () => {
  test('shouldReadJavaPackageWhenItEndsWithSemicolon', () => {
    expect(packageNameFromSource('package com.example;\npublic class Foo {}\n')).toBe('com.example');
  });

  test('shouldReadKotlinPackageWhenAFileAnnotationComesFirst', () => {
    const text = '@file:JvmName("FooKt")\n@file:JvmMultifileClass\npackage com.acme\n\nfun hello() = 1\n';
    expect(packageNameFromSource(text)).toBe('com.acme');
  });

  test('shouldSkipCommentsBeforeThePackage', () => {
    expect(packageNameFromSource('/* lead */\n// note\npackage com.x.y\n')).toBe('com.x.y');
  });

  test('shouldReturnNullWhenTheFileHasNoPackage', () => {
    expect(packageNameFromSource('class Lone {}\n')).toBeNull();
    expect(packageNameFromSource('')).toBeNull();
  });

  test('shouldReadPackageWhenALicenseHeaderIsLongerThan8Kb', () => {
    const header = `/*\n${' * license line\n'.repeat(1000)} */\n`;
    expect(header.length).toBeGreaterThan(8192);
    expect(packageNameFromSource(`${header}package com.example;\nclass A {}\n`)).toBe('com.example');
  });

  test('shouldReadPackageWhenManyLineCommentsPrecedeIt', () => {
    const header = '// license line\n'.repeat(1000);
    expect(packageNameFromSource(`${header}package com.example\n`)).toBe('com.example');
  });

  test('shouldJoinChainedScalaPackageClauses', () => {
    expect(packageNameFromSource('package a.b\npackage c\n\nclass X\n')).toBe('a.b.c');
    expect(packageNameFromSource('package a.b\n// note\npackage c.d\npackage e\nimport x.Y\n')).toBe('a.b.c.d.e');
  });

  test('shouldReturnFirstNameWhenScalaPackageUsesBlockForm', () => {
    expect(packageNameFromSource('package a.b {\n  class X\n}\n')).toBe('a.b');
  });

  test('shouldStopAtTheFirstDeclarationAfterThePackage', () => {
    expect(packageNameFromSource('package a;\nimport b.C;\npackage notAClause;\n')).toBe('a');
  });
});
