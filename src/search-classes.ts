import { pickResolvedConfiguration } from './extractor/pick-classpath.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import { ensureClassSearchIndex } from './class-search/ensure-class-search-index.js';
import { matchAndRankClassSearch } from './class-search/match-class-search.js';
import type { SearchClassesOptions, SearchClassesResult } from './class-search/types.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

export type { SearchClassesResult } from './class-search/types.js';

const DEFAULT_LIMIT = 50;

function emptyQueryError(): ClassSourceError {
  return {
    code: 'RESOLUTION_FAILED',
    message: 'search_classes: `query` must be a non-empty string after trimming.',
  };
}

/**
 * Resolves the project classpath (cached), ensures a class search index sidecar, and returns ranked FQN hits.
 */
export async function searchClasses(options: SearchClassesOptions): Promise<SearchClassesResult> {
  const query = options.query?.trim() ?? '';
  if (query.length === 0) {
    return { ok: false, error: emptyQueryError() };
  }

  const limit = options.limit ?? DEFAULT_LIMIT;

  const resolved = await resolveWithResolutionCache(options.projectRoot, {
    forceRefresh: Boolean(options.forceRefresh),
    diagnosticOperation: 'search_classes',
  });

  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        code: 'RESOLUTION_FAILED',
        message: resolved.message,
        stderr: resolved.stderr,
      },
      diagnosticId: resolved.diagnosticId,
      hint: resolved.hint,
    };
  }

  const picked = pickResolvedConfiguration(resolved.output, {
    modulePath: options.modulePath,
    configuration: options.configuration,
    includeTest: options.includeTest,
  });

  if (!picked.ok) {
    return { ok: false, error: picked.error };
  }

  const ensured = ensureClassSearchIndex(options.projectRoot, resolved.output, {
    module: picked.module,
    configuration: picked.configuration,
    includeTest: Boolean(options.includeTest),
  });

  if (!ensured.ok) {
    return {
      ok: false,
      error: { code: 'RESOLUTION_FAILED', message: ensured.message },
    };
  }

  const { hits, totalMatches } = matchAndRankClassSearch(ensured.file.entries, query, limit);

  return {
    ok: true,
    query,
    limit: Math.min(Math.max(limit, 1), 200),
    totalMatches,
    hits,
    indexMeta: ensured.file.meta,
  };
}
