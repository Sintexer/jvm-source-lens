import type { ClassSearchHit, ClassSearchIndexEntry } from './types.js';

export type ParsedClassSearchQuery =
  | { kind: 'glob'; pattern: string; regex: RegExp }
  | { kind: 'substring'; needle: string };

export function parseClassSearchQuery(query: string): ParsedClassSearchQuery {
  const t = query.trim();
  if (/[*?]/.test(t)) {
    return { kind: 'glob', pattern: t, regex: globToRegex(t) };
  }
  return { kind: 'substring', needle: t.toLowerCase() };
}

function globToRegex(pattern: string): RegExp {
  let s = '';
  for (const c of pattern) {
    if (c === '*') {
      s += '.*';
    } else if (c === '?') {
      s += '.';
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      s += `\\${c}`;
    } else {
      s += c;
    }
  }
  return new RegExp(`^${s}$`, 'i');
}

function scoreGlob(regex: RegExp, e: ClassSearchIndexEntry): number {
  if (regex.test(e.className) || regex.test(e.simpleName)) {
    return 7_000_000;
  }
  return -1;
}

function scoreSubstring(needle: string, e: ClassSearchIndexEntry): number {
  if (needle.length === 0) {
    return -1;
  }
  const fqn = e.className.toLowerCase();
  const simple = e.simpleName.toLowerCase();
  const blob = e.searchText;

  if (simple === needle) {
    return 10_000_000;
  }
  if (fqn === needle) {
    return 9_500_000;
  }
  if (fqn.endsWith(`.${needle}`)) {
    return 8_000_000;
  }
  const inFqn = fqn.indexOf(needle);
  if (inFqn >= 0) {
    return 6_000_000 - Math.min(inFqn, 4999);
  }
  const inBlob = blob.indexOf(needle);
  if (inBlob >= 0) {
    return 3_000_000 - Math.min(inBlob, 1999);
  }
  return -1;
}

function entryToHit(e: ClassSearchIndexEntry, score: number): ClassSearchHit {
  return {
    className: e.className,
    simpleName: e.simpleName,
    moduleName: e.resolvedModuleName,
    configurationName: e.configurationName,
    origin: e.origin,
    coordinates: { group: e.group, name: e.name, version: e.version },
    jarPath: e.jarPath,
    moduleRoot: e.moduleRoot,
    interprojectModuleName: e.interprojectModuleName,
    score,
  };
}

/**
 * Filters and ranks index entries; deduplicates by `className` keeping the best score.
 */
export function matchAndRankClassSearch(
  entries: ClassSearchIndexEntry[],
  query: string,
  limit: number,
): { hits: ClassSearchHit[]; totalMatches: number } {
  const lim = Math.min(Math.max(limit, 1), 200);
  const parsed = parseClassSearchQuery(query);
  const best = new Map<string, ClassSearchHit>();

  for (const e of entries) {
    const score =
      parsed.kind === 'glob' ? scoreGlob(parsed.regex, e) : scoreSubstring(parsed.needle, e);
    if (score < 0) {
      continue;
    }
    const prev = best.get(e.className);
    if (prev !== undefined && prev.score >= score) {
      continue;
    }
    best.set(e.className, entryToHit(e, score));
  }

  const list = [...best.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.className.localeCompare(b.className);
  });

  return { hits: list.slice(0, lim), totalMatches: list.length };
}
