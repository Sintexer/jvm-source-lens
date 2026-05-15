import type { ResolvedArtifact } from '../resolvers/resolution-output.js';

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

export type ResolveSourcesJarFn = (coordinates: ArtifactCoordinates) => Promise<string | null>;

export type ClassSourceLookupOptions = {
  className: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  /** When set, fetches sources for the winning artifact only (Gradle on-demand). */
  resolveSourcesJar?: ResolveSourcesJarFn;
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
      code: 'DECOMPILE_NOT_IMPLEMENTED';
      message: string;
      className: string;
      jarPath: string;
      entryRelPath: string;
      coordinates: ArtifactCoordinates;
    }
  | { code: 'ZIP_READ_ERROR'; message: string; jarPath: string; entryRelPath?: string }
  | { code: 'RESOLUTION_FAILED'; message: string; stderr?: string }
  | {
      code: 'SOURCES_RESOLVE_FAILED';
      message: string;
      coordinates: ArtifactCoordinates;
      stderr?: string;
    };

export type ClassSourceLookupResult =
  | {
      ok: true;
      source: string;
      sourceAvailable: true;
      className: string;
      provenance: SourcesJarProvenance;
    }
  | { ok: false; error: ClassSourceError };

export function isExternalJarArtifact(a: ResolvedArtifact): boolean {
  return a.origin === 'external' && a.type === 'jar';
}
