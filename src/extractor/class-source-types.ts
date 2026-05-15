import type { ResolvedArtifact } from '../resolvers/resolution-output.js';
import type { DecompileExternalClassFn } from '../decompiler/decompile-external-class.js';

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
      code: 'CLASS_NOT_FOUND';
      message: string;
      className: string;
      searchedArtifactCount: number;
    }
  | {
      code: 'DECOMPILE_FAILED';
      message: string;
      className: string;
      jarPath: string;
      entryRelPath: string;
      coordinates: ArtifactCoordinates;
      stderr?: string;
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
    };

export type ClassSourceLookupResult =
  | {
      ok: true;
      source: string;
      sourceAvailable: boolean;
      className: string;
      provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
    }
  | { ok: false; error: ClassSourceError };

export function isExternalJarArtifact(a: ResolvedArtifact): boolean {
  return a.origin === 'external' && a.type === 'jar';
}
