import type {
  ClassSourceError,
  ClassSourceLookupResult,
  DecompiledProvenance,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
import {
  searchClassSourceText,
  type ClassSourceTextSearchHit,
} from './class-source-text-search.js';
import { buildFindInClassNoMatchMessage } from './guided-response/messages.js';
import { getClassSource, type GetClassSourceCliOptions, type GetClassSourceOptions } from './get-class-source.js';

export type FindInClassSourceOptions = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
  query: string;
  contextLines?: number;
  maxHits?: number;
  regex?: boolean;
  cli?: GetClassSourceCliOptions;
};

export type FindInClassSourceSuccess = {
  ok: true;
  found: true;
  className: string;
  sourceAvailable: boolean;
  provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
  query: string;
  regex: boolean;
  lineNumbersReliable: boolean;
  totalMatches: number;
  hitCount: number;
  truncated: boolean;
  hits: ClassSourceTextSearchHit[];
};

export type FindInClassSourceNoMatches = {
  ok: true;
  found: false;
  querySucceeded: true;
  className: string;
  query: string;
  regex: boolean;
  sourceAvailable: boolean;
  provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
  message: string;
};

export type FindInClassSourceResult =
  | FindInClassSourceSuccess
  | FindInClassSourceNoMatches
  | { ok: false; error: ClassSourceError; diagnosticId?: string; hint?: string };

function toGetOpts(opts: FindInClassSourceOptions): GetClassSourceOptions {
  return {
    projectRoot: opts.projectRoot,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
    forceRefresh: opts.forceRefresh,
    cli: opts.cli,
  };
}

function mapSearchError(
  err: Extract<ReturnType<typeof searchClassSourceText>, { error: unknown }>['error'],
): ClassSourceError {
  if (err.code === 'FIND_QUERY_INVALID') {
    return { code: 'FIND_QUERY_INVALID', message: err.message };
  }
  return {
    code: 'FIND_SOURCE_TOO_LARGE',
    message: err.message,
    byteLength: err.byteLength,
  };
}

function successFromSource(
  extracted: Extract<ClassSourceLookupResult, { ok: true }>,
  query: string,
  regex: boolean,
  search: { hits: ClassSourceTextSearchHit[]; totalMatches: number; truncated: boolean },
): FindInClassSourceResult {
  if (search.hits.length === 0) {
    return {
      ok: true,
      found: false,
      querySucceeded: true,
      className: extracted.className,
      query,
      regex,
      sourceAvailable: extracted.sourceAvailable,
      provenance: extracted.provenance,
      message: buildFindInClassNoMatchMessage({
        className: extracted.className,
        query,
        regex,
        sourceAvailable: extracted.sourceAvailable,
      }),
    };
  }

  return {
    ok: true,
    found: true,
    className: extracted.className,
    sourceAvailable: extracted.sourceAvailable,
    provenance: extracted.provenance,
    query,
    regex,
    lineNumbersReliable: extracted.sourceAvailable,
    totalMatches: search.totalMatches,
    hitCount: search.hits.length,
    truncated: search.truncated,
    hits: search.hits,
  };
}

/**
 * Resolves classpath source for `className`, then searches the compilation unit for `query`.
 */
export async function findInClassSource(
  className: string,
  opts: FindInClassSourceOptions,
): Promise<FindInClassSourceResult> {
  const sourceResult = await getClassSource(className, toGetOpts(opts));
  if (!sourceResult.ok) {
    return sourceResult;
  }

  const search = searchClassSourceText(sourceResult.source, {
    query: opts.query,
    contextLines: opts.contextLines,
    maxHits: opts.maxHits,
    regex: Boolean(opts.regex),
  });

  if ('error' in search) {
    return { ok: false, error: mapSearchError(search.error) };
  }

  return successFromSource(sourceResult, opts.query, Boolean(opts.regex), search);
}
