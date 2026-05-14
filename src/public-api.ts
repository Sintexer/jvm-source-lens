export { getClassSource, type GetClassSourceOptions } from './get-class-source.js';
export { resolveWithResolutionCache, type ResolveWithResolutionCacheOptions } from './resolve-with-cache.js';
export {
  extractExternalClassSource,
} from './extractor/extract-external-class-source.js';
export type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  ClassSourceLookupResult,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
export { pickResolvedConfiguration, type PickClasspathOptions } from './extractor/pick-classpath.js';
export { fqnToZipRelPaths } from './extractor/fqn-paths.js';
export type {
  ResolutionOutput,
  ResolvedArtifact,
  ResolvedConfiguration,
  ResolvedModule,
} from './resolvers/resolution-output.js';
