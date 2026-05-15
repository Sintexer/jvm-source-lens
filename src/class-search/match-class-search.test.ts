import { describe, expect, test } from 'bun:test';
import type { ClassSearchIndexEntry } from './types.js';
import { matchAndRankClassSearch, parseClassSearchQuery } from './match-class-search.js';

function entry(partial: Partial<ClassSearchIndexEntry> & Pick<ClassSearchIndexEntry, 'className'>): ClassSearchIndexEntry {
  const simple = partial.simpleName ?? partial.className.split('.').pop() ?? partial.className;
  const searchText = `${partial.className}\n${simple}`.toLowerCase();
  return {
    simpleName: simple,
    searchText,
    origin: 'external',
    group: 'g',
    name: 'n',
    version: '1',
    resolvedModuleName: 'root',
    configurationName: 'compileClasspath',
    jarPath: '/x.jar',
    moduleRoot: null,
    interprojectModuleName: null,
    ...partial,
  };
}

describe('match-class-search', () => {
  test('parseClassSearchQuery detects glob vs substring', () => {
    expect(parseClassSearchQuery('Foo').kind).toBe('substring');
    expect(parseClassSearchQuery('com.*.Bar').kind).toBe('glob');
    expect(parseClassSearchQuery('com.?oo').kind).toBe('glob');
  });

  test('substring: exact simple name ranks above partial FQN match', () => {
    const entries = [
      entry({ className: 'com.example.FooRepository' }),
      entry({ className: 'com.other.Repository' }),
    ];
    const { hits } = matchAndRankClassSearch(entries, 'Repository', 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.className).toBe('com.other.Repository');
    expect(hits[0]!.simpleName).toBe('Repository');
  });

  test('substring: dedupes by className keeping best score', () => {
    const entries = [
      entry({ className: 'com.a.X', group: 'g1' }),
      entry({ className: 'com.a.X', group: 'g2' }),
    ];
    const { hits, totalMatches } = matchAndRankClassSearch(entries, 'com.a', 10);
    expect(totalMatches).toBe(1);
    expect(hits).toHaveLength(1);
  });

  test('glob matches FQN or simple name', () => {
    const entries = [
      entry({ className: 'com.foo.HttpClient' }),
      entry({ className: 'com.bar.Other' }),
    ];
    const { hits } = matchAndRankClassSearch(entries, 'com.*.HttpClient', 10);
    expect(hits.map((h) => h.className)).toEqual(['com.foo.HttpClient']);
  });

  test('limit is clamped to 200 and totalMatches ignores limit', () => {
    const entries: ClassSearchIndexEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      entries.push(entry({ className: `com.z.Z${i}` }));
    }
    const { hits, totalMatches } = matchAndRankClassSearch(entries, 'com.z', 5);
    expect(totalMatches).toBe(30);
    expect(hits).toHaveLength(5);
  });

  test('substring matches v2-enriched searchText (method name absent from FQN)', () => {
    const entries = [
      entry({
        className: 'com.example.Util',
        searchText: 'com.example.util\nutil\ndoquerystuff',
      }),
    ];
    const { hits } = matchAndRankClassSearch(entries, 'doquerystuff', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.className).toBe('com.example.Util');
  });
});
