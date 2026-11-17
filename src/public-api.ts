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
