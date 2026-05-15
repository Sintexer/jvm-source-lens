import type { ClassSourceError } from '../extractor/class-source-types.js';

export const CLASS_SEARCH_INDEX_FORMAT_VERSION = 2 as const;

export type ClassSearchArtifactOrigin = 'external' | 'interproject';

/** One classpath element’s contribution (flattened per FQN). */
export type ClassSearchIndexEntry = {
  /** Fully qualified class name */
  className: string;
  simpleName: string;
  /** Lowercased text for substring ranking: FQN + simpleName; v2 appends method/field/javadoc from sources when available */
  searchText: string;
  origin: ClassSearchArtifactOrigin;
  group: string;
  name: string;
  version: string | null;
  /** Owning Gradle module for the selected configuration (e.g. `root`, `:app`). */
  resolvedModuleName: string;
  configurationName: string;
  /** Binary JAR path when `origin === 'external'` */
  jarPath: string | null;
  /** Interproject depended module root when `origin === 'interproject'` */
  moduleRoot: string | null;
  /** `interproject.moduleName` from resolution when interproject */
  interprojectModuleName: string | null;
};

export type ClassSearchIndexMeta = {
  indexFormatVersion: typeof CLASS_SEARCH_INDEX_FORMAT_VERSION;
  buildInputsDigest: string;
  resolutionFingerprint: string;
  /** Gradle module name matching `pickResolvedConfiguration` */
  moduleName: string;
  configurationName: string;
  includeTest: boolean;
  builtAt: string;
  entryCount: number;
  skippedArtifacts: number;
  /** Entries whose `searchText` includes source-derived method / field / Javadoc text */
  sourceEnrichedEntries: number;
  /** Per-file cap (bytes) applied when reading `.java` / sources-JAR entries for enrichment */
  sourceEnrichmentBytesCap: number;
};

export type ClassSearchIndexFileV1 = {
  meta: ClassSearchIndexMeta;
  entries: ClassSearchIndexEntry[];
};

export type ClassSearchHit = {
  className: string;
  simpleName: string;
  moduleName: string;
  configurationName: string;
  origin: ClassSearchArtifactOrigin;
  coordinates: { group: string; name: string; version: string | null };
  jarPath: string | null;
  moduleRoot: string | null;
  interprojectModuleName: string | null;
  score: number;
};

export type SearchClassesOptions = {
  projectRoot: string;
  query: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
  /** Default 50; clamped to max 200 */
  limit?: number;
};

export type SearchClassesResult =
  | {
      ok: true;
      query: string;
      limit: number;
      totalMatches: number;
      hits: ClassSearchHit[];
      indexMeta: ClassSearchIndexMeta;
    }
  | { ok: false; error: ClassSourceError; diagnosticId?: string; hint?: string };
