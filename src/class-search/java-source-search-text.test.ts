import { describe, expect, test } from 'bun:test';
import {
  buildJavaSourceSearchBlob,
  extractJavadocPlainText,
  MAX_JAVA_SOURCE_BYTES_FOR_SEARCH,
} from './java-source-search-text.js';

describe('java-source-search-text', () => {
  test('extractJavadocPlainText strips stars and normalizes whitespace', () => {
    const src = `
    /** First line
     * second line */
    package p;
    class C {}
    `;
    const t = extractJavadocPlainText(src);
    expect(t.toLowerCase()).toContain('first');
    expect(t.toLowerCase()).toContain('second');
  });

  test('buildJavaSourceSearchBlob includes method names, fields, and class Javadoc', () => {
    const src = `
    package com.ex;
    /** Widget for frobbing. */
    public class Foo {
      private int x;
      /** Runs the engine. */
      public void runEngine(String a) {}
      public Foo() {}
    }
    `;
    const blob = buildJavaSourceSearchBlob(src, 'com.ex.Foo');
    expect(blob).toContain('runengine');
    expect(blob).toContain('frobbing');
    expect(blob).toContain('engine');
    expect(blob).toContain('x');
    expect(blob).toContain('foo');
  });

  test('buildJavaSourceSearchBlob still yields Javadoc when parseJavaTypeMetadata returns null', () => {
    const src = `
    /** orphan block before package */
    package p;
    class Unrelated { }
    `;
    const blob = buildJavaSourceSearchBlob(src, 'p.Missing');
    expect(blob).toContain('orphan');
  });

  test('does not throw on very large source (bounded read)', () => {
    const huge = `package p;\npublic class C {\n${'void m() {}\n'.repeat(50_000)}}`;
    expect(() => buildJavaSourceSearchBlob(huge, 'p.C')).not.toThrow();
    expect(MAX_JAVA_SOURCE_BYTES_FOR_SEARCH).toBeGreaterThan(0);
  });
});
