import { describe, expect, test } from 'bun:test';
import { readSourceFileAttribute } from './class-file-source-file.js';
import { buildClassFile } from './test-class-file.js';

describe('readSourceFileAttribute', () => {
  test('returns the SourceFile value after fields, methods and other attributes', () => {
    const bytes = buildClassFile({ internalName: 'com/x/FooKt', sourceFile: 'Foo.kt' });
    expect(readSourceFileAttribute(bytes)).toBe('Foo.kt');
  });

  test('returns null when the attribute is absent', () => {
    expect(readSourceFileAttribute(buildClassFile({ internalName: 'com/x/Foo' }))).toBeNull();
  });

  test('returns null for truncated bytes', () => {
    const bytes = buildClassFile({ internalName: 'com/x/Foo', sourceFile: 'Foo.java' });
    expect(readSourceFileAttribute(bytes.slice(0, bytes.length - 3))).toBeNull();
    expect(readSourceFileAttribute(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]))).toBeNull();
  });

  test('returns null without the class-file magic', () => {
    const bytes = buildClassFile({ internalName: 'com/x/Foo', sourceFile: 'Foo.java' });
    bytes[0] = 0;
    expect(readSourceFileAttribute(bytes)).toBeNull();
  });

  test('returns null for an obfuscated or path-like value', () => {
    for (const sourceFile of ['SourceFile', '../x.java', 'a/b.java', 'a\\b.kt', 'Foo.txt']) {
      expect(readSourceFileAttribute(buildClassFile({ internalName: 'com/x/Foo', sourceFile }))).toBeNull();
    }
  });

  test('accepts the JVM source languages', () => {
    for (const sourceFile of ['Foo.java', 'Foo.kt', 'Foo.scala', 'Foo.groovy']) {
      expect(readSourceFileAttribute(buildClassFile({ internalName: 'com/x/Foo', sourceFile }))).toBe(sourceFile);
    }
  });
});
