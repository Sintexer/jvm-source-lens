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
});
