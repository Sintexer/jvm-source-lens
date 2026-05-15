export { getClassSource, type GetClassSourceOptions } from './get-class-source.js';
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
export { resolveSourcesJar, type ResolveSourcesJarResult } from './resolvers/gradle/resolve-sources-jar.js';
export type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  ClassSourceLookupResult,
  DecompiledProvenance,
  ResolveSourcesJarFn,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
export { decompileExternalClass } from './decompiler/index.js';
export { pickResolvedConfiguration, type PickClasspathOptions } from './extractor/pick-classpath.js';
export { fqnToZipRelPaths } from './extractor/fqn-paths.js';
export type {
  ResolutionOutput,
  ResolvedArtifact,
  ResolvedConfiguration,
  ResolvedModule,
} from './resolvers/resolution-output.js';
