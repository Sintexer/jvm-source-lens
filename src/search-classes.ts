import { pickResolvedConfiguration } from './extractor/pick-classpath.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import { ensureClassSearchIndex } from './class-search/ensure-class-search-index.js';
import { matchAndRankClassSearch } from './class-search/match-class-search.js';
import type { ClassSearchHit, ClassSearchIndexEntry, SearchClassesOptions, SearchClassesResult } from './class-search/types.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import type { ResolutionOutput } from './resolvers/resolution-output.js';

export type { SearchClassesResult } from './class-search/types.js';

const DEFAULT_LIMIT = 50;

function emptyQueryError(): ClassSourceError {
  return {
    code: 'RESOLUTION_FAILED',
    message: 'search_classes: `query` must be a non-empty string after trimming.',
  };
}

/** Identity of "this class from this artifact"; modules that resolve the same artifact share it. */
function artifactKey(e: ClassSearchIndexEntry): string {
  return [e.className, e.group, e.name, e.version ?? '', e.jarPath ?? '', e.interprojectModuleName ?? ''].join('\0');
}

function hitArtifactKey(h: ClassSearchHit): string {
  return [
    h.className,
    h.coordinates.group,
    h.coordinates.name,
    h.coordinates.version ?? '',
    h.jarPath ?? '',
    h.interprojectModuleName ?? '',
  ].join('\0');
}

export function searchClassesAcrossModules(
  options: SearchClassesOptions,
  output: ResolutionOutput,
  modulePaths: string[],
  query: string,
  limit: number,
): SearchClassesResult {
  const entries: ClassSearchIndexEntry[] = [];
  const searchedModules: string[] = [];
  const modulesByKey = new Map<string, Set<string>>();
  let meta: Extract<SearchClassesResult, { ok: true }>['indexMeta'] | undefined;

  for (const modulePath of modulePaths) {
    const picked = pickResolvedConfiguration(output, {
      modulePath,
      configuration: options.configuration,
      includeTest: options.includeTest,
    });
    if (!picked.ok) {
      continue;
    }
    const ensured = ensureClassSearchIndex(options.projectRoot, output, {
      module: picked.module,
      configuration: picked.configuration,
      includeTest: Boolean(options.includeTest),
    });
    if (!ensured.ok) {
      return { ok: false, error: { code: 'RESOLUTION_FAILED', message: ensured.message } };
    }
    meta ??= ensured.file.meta;
    searchedModules.push(modulePath);
    for (const e of ensured.file.entries) {
      const key = artifactKey(e);
      const modules = modulesByKey.get(key);
      if (modules === undefined) {
        modulesByKey.set(key, new Set([modulePath]));
        entries.push(e);
      } else {
        modules.add(modulePath);
      }
    }
  }
  if (meta === undefined) {
    return { ok: false, error: { code: 'RESOLUTION_FAILED', message: 'No module could be indexed for search_classes.' } };
  }

  const { hits, totalMatches } = matchAndRankClassSearch(entries, query, limit, artifactKey);
  const withModules = hits.map((h) => ({
    ...h,
    modules: [...(modulesByKey.get(hitArtifactKey(h)) ?? [])].sort(),
  }));

  return {
    ok: true,
    query,
    limit: Math.min(Math.max(limit, 1), 200),
    totalMatches,
    hits: withModules,
    indexMeta: meta,
    searchedModules,
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
    // No modulePath on a multi-module build: search every module that has the classpath instead of failing.
    if (picked.error.code === 'MODULE_AMBIGUOUS' && picked.error.className === undefined) {
      return searchClassesAcrossModules(options, resolved.output, picked.error.modulePaths, query, limit);
    }
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
