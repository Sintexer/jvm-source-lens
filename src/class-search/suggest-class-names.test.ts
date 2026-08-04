import { describe, expect, test } from 'bun:test';
import type { ClassSearchIndexEntry } from './types.js';
import { suggestClassNamesBySimpleName } from './suggest-class-names.js';

function entry(partial: Partial<ClassSearchIndexEntry> & Pick<ClassSearchIndexEntry, 'className'>): ClassSearchIndexEntry {
  const simple = partial.simpleName ?? partial.className.split('.').pop() ?? partial.className;
  return {
    className: partial.className,
    simpleName: simple,
    searchText: `${partial.className}\n${simple}`.toLowerCase(),
    origin: partial.origin ?? 'external',
    group: partial.group ?? 'g',
    name: partial.name ?? 'a',
    version: partial.version ?? '1.0',
    resolvedModuleName: partial.resolvedModuleName ?? 'root',
    configurationName: partial.configurationName ?? 'compileClasspath',
    jarPath: partial.jarPath ?? null,
    moduleRoot: partial.moduleRoot ?? null,
    interprojectModuleName: partial.interprojectModuleName ?? null,
  };
}

describe('suggestClassNamesBySimpleName', () => {
  test('finds exact simple-name matches under a different package', () => {
    const entries = [
      entry({ className: 'com.example.v1.Foo' }),
      entry({ className: 'com.example.v2.Foo' }),
      entry({ className: 'com.other.Bar' }),
    ];
    const suggestions = suggestClassNamesBySimpleName(entries, 'com.example.v1.Foo');
    expect(suggestions).toContain('com.example.v2.Foo');
    expect(suggestions).not.toContain('com.example.v1.Foo');
    expect(suggestions).not.toContain('com.other.Bar');
  });

  test('is case-insensitive on the simple name', () => {
    const entries = [entry({ className: 'com.example.FOO', simpleName: 'FOO' })];
    const suggestions = suggestClassNamesBySimpleName(entries, 'com.other.foo');
    expect(suggestions).toEqual(['com.example.FOO']);
  });

  test('returns empty array when nothing shares the simple name', () => {
    const entries = [entry({ className: 'com.other.Bar' })];
    expect(suggestClassNamesBySimpleName(entries, 'com.example.Foo')).toEqual([]);
  });

  test('caps results at the provided limit', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry({ className: `com.pkg${i}.Foo` }));
    const suggestions = suggestClassNamesBySimpleName(entries, 'com.example.Foo', 3);
    expect(suggestions.length).toBe(3);
  });

  test('defaults to a limit of 5', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry({ className: `com.pkg${i}.Foo` }));
    expect(suggestClassNamesBySimpleName(entries, 'com.example.Foo').length).toBe(5);
  });

  test('handles a simple-name (no package) className query', () => {
    const entries = [entry({ className: 'com.example.Foo' })];
    expect(suggestClassNamesBySimpleName(entries, 'Foo')).toEqual(['com.example.Foo']);
  });
});
