import { describe, expect, test } from 'bun:test';
import { sourceLanguageFromPath } from './class-source-types.js';

describe('sourceLanguageFromPath', () => {
  test('shouldMapKnownSourceExtensions', () => {
    expect(sourceLanguageFromPath('com/acme/Foo.java')).toBe('java');
    expect(sourceLanguageFromPath('com/acme/Foo.kt')).toBe('kotlin');
    expect(sourceLanguageFromPath('com/acme/Foo.scala')).toBe('scala');
    expect(sourceLanguageFromPath('com/acme/Foo.groovy')).toBe('groovy');
  });

  test('shouldUseJavaWhenThePathIsMissingOrNotSource', () => {
    expect(sourceLanguageFromPath(null)).toBe('java');
    expect(sourceLanguageFromPath(undefined)).toBe('java');
    expect(sourceLanguageFromPath('com/acme/Foo.class')).toBe('java');
  });
});
