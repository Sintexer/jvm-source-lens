import type { ResolvedArtifact } from '../resolvers/resolution-output.js';
import type { DecompileExternalClassFn } from '../decompiler/decompile-external-class.js';
import type { SourceExcerptInfo } from '../source-excerpt.js';

export type ArtifactCoordinates = {
  group: string;
  name: string;
  version: string | null;
};

export type SourcesJarProvenance = {
  kind: 'sourcesJar';
  coordinates: ArtifactCoordinates;
  jarPath: string;
};

export type DecompiledProvenance = {
  kind: 'decompiled';
  coordinates: ArtifactCoordinates;
  jarPath: string;
  entryRelPath: string;
  cachePath: string;
};

/** Local `.java` in a depended Gradle submodule (`origin: interproject`). */
export type InterprojectProvenance = {
  kind: 'interproject';
  coordinates: ArtifactCoordinates;
  moduleName: string;
  /** Absolute depended project dir (`projectDir`). */
  moduleRoot: string;
  sourceRelativePath: string;
  absoluteSourcePath: string;
};

export type ResolveSourcesJarFn = (coordinates: ArtifactCoordinates) => Promise<string | null>;

export type ClassSourceLookupOptions = {
  className: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  /** When set, fetches sources for the winning artifact only (Gradle on-demand). */
  resolveSourcesJar?: ResolveSourcesJarFn;
  /** When set, invoked only if CFR runs (not on decompilation cache hit). */
  onBeforeDecompile?: () => void;
  /** Override for tests; defaults to CFR decompilation with global cache. */
  decompileExternalClass?: DecompileExternalClassFn;
};

export type ClassSourceError =
  | { code: 'INVALID_FQN'; message: string }
  | { code: 'MODULE_NOT_FOUND'; message: string; modulePath: string }
  | {
      code: 'CONFIGURATION_NOT_FOUND';
      message: string;
      moduleName: string;
      configuration: string;
    }
  | {
      code: 'MODULE_AMBIGUOUS';
      message: string;
      modulePaths: string[];
      className: string;
    }
  | {
      code: 'CLASS_NOT_FOUND';
      message: string;
      className: string;
      searchedArtifactCount: number;
      /** Exact simple-name alternate FQNs (did-you-mean), from the class-search index when available. */
      suggestions?: string[];
      /** Concrete module names to retry with when `modulePath` was omitted on a multimodule project. */
      suggestedModulePaths?: string[];
    }
  | {
      code: 'DECOMPILE_FAILED';
      message: string;
      className: string;
      jarPath: string;
      entryRelPath: string;
      coordinates: ArtifactCoordinates;
      stderr?: string;
      /** CFR argv when a JVM process was started (SPEC §6.3 diagnostics). */
      command?: string[];
    }
  | { code: 'ZIP_READ_ERROR'; message: string; jarPath: string; entryRelPath?: string }
  | { code: 'RESOLUTION_FAILED'; message: string; stderr?: string }
  | {
      code: 'SOURCES_RESOLVE_FAILED';
      message: string;
      coordinates: ArtifactCoordinates;
      stderr?: string;
    }
  | {
      code: 'SIGNATURE_EXTRACT_FAILED';
      message: string;
      className: string;
      /** Present for `get_method_signature`; omitted for `get_class_structure` (whole-class javap). */
      methodName?: string;
      jarPath: string;
      stderr?: string;
    }
  | { code: 'EXCERPT_REQUEST_INVALID'; message: string }
  | {
      code: 'EXCERPT_NOT_FOUND';
      message: string;
      className: string;
      requestedMethodNames: string[];
      unmatchedMethodNames: string[];
    }
  | { code: 'FIND_QUERY_INVALID'; message: string }
  | { code: 'FIND_SOURCE_TOO_LARGE'; message: string; byteLength: number }
  | {
      code: 'ARTIFACT_NOT_FOUND';
      message: string;
      modulePath?: string;
      configuration?: string;
    }
  | {
      code: 'ARTIFACT_AMBIGUOUS';
      message: string;
      candidates: Array<{ group: string; name: string; version: string | null; jarPath: string | null }>;
    };

export type ClassSourceLookupResult =
  | {
      ok: true;
      source: string;
      sourceAvailable: boolean;
      className: string;
      provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
      excerpt?: SourceExcerptInfo;
      /** True when `source` was truncated to `JVMSRC_MAX_SOURCE_OUTPUT_CHARS`. */
      outputTruncated?: boolean;
      /** Original UTF-16 length before truncation. */
      sourceLength?: number;
    }
  | { ok: false; error: ClassSourceError; diagnosticId?: string; hint?: string };

export function isExternalJarArtifact(a: ResolvedArtifact): boolean {
  return a.origin === 'external' && a.type === 'jar';
}

/** Resolved Maven JAR or `local-file` `.jar` on classpath (ZIP class lookup + optional embedded sources). */
export function isClasspathBinaryJarArtifact(a: ResolvedArtifact): boolean {
  if (a.jarPath === null || a.jarPath.length === 0) {
    return false;
  }
  if (!a.jarPath.toLowerCase().endsWith('.jar')) {
    return false;
  }
  if (isExternalJarArtifact(a)) {
    return true;
  }
  return a.origin === 'local-file' && a.type === 'local-file';
}
