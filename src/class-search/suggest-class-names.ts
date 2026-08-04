import { matchAndRankClassSearch } from './match-class-search.js';
import type { ClassSearchIndexEntry } from './types.js';

const DEFAULT_SUGGESTION_LIMIT = 5;

function lastSegment(className: string): string {
  const idx = className.lastIndexOf('.');
  return idx >= 0 ? className.slice(idx + 1) : className;
}

/**
 * "Did you mean" candidates for a `CLASS_NOT_FOUND` miss: other FQNs on the classpath sharing the
 * same simple name (case-insensitive), ranked via {@link matchAndRankClassSearch}. Excludes the
 * exact FQN that was already missed.
 */
export function suggestClassNamesBySimpleName(
  entries: ClassSearchIndexEntry[],
  className: string,
  limit = DEFAULT_SUGGESTION_LIMIT,
): string[] {
  const simple = lastSegment(className);
  if (simple.length === 0) {
    return [];
  }
  const simpleLower = simple.toLowerCase();
  const candidates = entries.filter(
    (e) => e.simpleName.toLowerCase() === simpleLower && e.className !== className,
  );
  if (candidates.length === 0) {
    return [];
  }
  const { hits } = matchAndRankClassSearch(candidates, simple, limit);
  return hits.map((h) => h.className);
}
