export { getClassSource, type GetClassSourceCliOptions, type GetClassSourceOptions } from './get-class-source.js';
export {
  applySourceExcerpt,
  mergeSourceExcerptInputs,
  type SourceExcerptInfo,
  type SourceExcerptRequest,
} from './source-excerpt.js';
export { findInClassSource, type FindInClassSourceOptions, type FindInClassSourceResult } from './find-in-class-source.js';
export { searchClassSourceText, type ClassSourceTextSearchHit } from './class-source-text-search.js';
export { getClassStructure, type GetClassStructureOptions } from './get-class-structure.js';
export type {
  ClassStructureDeclaredAnnotation,
  ClassStructureField,
  ClassStructureIncludeSection,
  ClassStructureKind,
  ClassStructureMethod,
  ClassStructureTypeHierarchy,
  GetClassStructureResult,
} from './class-structure/types.js';
export { resolveWithResolutionCache, type ResolveWithResolutionCacheOptions } from './resolve-with-cache.js';
export { extractExternalClassSource } from './extractor/extract-external-class-source.js';
export type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  ClassSourceLookupResult,
  DecompiledProvenance,
  ResolveSourcesJarFn,
  SourceLanguage,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
export { decompileExternalClass } from './decompiler/index.js';
export { pickResolvedConfiguration, type PickClasspathOptions } from './extractor/pick-classpath.js';
export { fqnToZipRelPaths } from './extractor/fqn-paths.js';
export {
  allResolvers,
  detectResolver,
  resolverById,
  UnsupportedProjectError,
  type BuildCacheInputs,
  type BuildSystemInfo,
  type DependencyResolver,
  type GradleProcessCapture,
  type ResolutionOutput,
  type ResolutionResult,
  type ResolveOptions,
  type ResolvePhaseInfo,
  type ResolveSourcesJarResult,
  type ResolvedArtifact,
  type ResolvedConfiguration,
  type ResolvedModule,
  type SubprocessCapture,
  type SubprocessHooks,
} from './resolvers/index.js';

import type { ArtifactCoordinates } from './extractor/class-source-types.js';
import {
  detectResolver,
  type DependencyResolver,
  type ResolveSourcesJarResult,
  type SubprocessHooks,
} from './resolvers/index.js';

/** @deprecated Use `SubprocessHooks`. Kept for one release. */
export type ResolveSourcesJarGradleOptions = SubprocessHooks & {
  /** @deprecated Use `onBeforeResolve`. Kept for one release. */
  onBeforeGradle?: () => void;
  /** @deprecated Use `onAfterResolve`. Kept for one release. */
  onAfterGradle?: () => void;
};

/**
 * Resolves (and downloads if needed) the sources JAR for one artifact via the detected
 * `DependencyResolver` for `projectRoot`.
 *
 * @deprecated Prefer `detectResolver(projectRoot).resolveSourcesJar(projectRoot, coordinates, hooks)`. Kept for one release.
 */
export async function resolveSourcesJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  options?: ResolveSourcesJarGradleOptions,
): Promise<ResolveSourcesJarResult> {
  let resolver: DependencyResolver;
  try {
    resolver = detectResolver(projectRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
  const hooks: SubprocessHooks | undefined = options
    ? {
        inheritStderr: options.inheritStderr,
        onBeforeResolve:
          options.onBeforeResolve ??
          (options.onBeforeGradle ? () => options.onBeforeGradle?.() : undefined),
        onAfterResolve: options.onAfterResolve ?? options.onAfterGradle,
      }
    : undefined;
  return resolver.resolveSourcesJar(projectRoot, coordinates, hooks);
}
