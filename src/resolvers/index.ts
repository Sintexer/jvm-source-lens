import type { DependencyResolver } from './base.js';
import { GradleResolver } from './gradle/index.js';
import { MavenResolver } from './maven/index.js';

const RESOLVERS: DependencyResolver[] = [new GradleResolver(), new MavenResolver()];

export class UnsupportedProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedProjectError';
  }
}

export function allResolvers(): readonly DependencyResolver[] {
  return [...RESOLVERS];
}

export function resolverById(id: string): DependencyResolver | undefined {
  return RESOLVERS.find((r) => r.id === id);
}

export function detectResolver(projectRoot: string): DependencyResolver {
  const resolver = RESOLVERS.find((r) => r.detect(projectRoot));
  if (!resolver) {
    const supported = RESOLVERS.map((r) => r.displayName).join(', ');
    throw new UnsupportedProjectError(
      `No supported build system found in ${projectRoot}. ` +
        `Currently supported: ${supported}. Contributions welcome.`,
    );
  }
  return resolver;
}

/**
 * Prepends `resolver` to the registry for in-process end-to-end tests and returns a cleanup
 * callback that removes it.
 *
 * @internal
 */
export function registerResolverForTesting(resolver: DependencyResolver): () => void {
  RESOLVERS.unshift(resolver);
  return () => {
    const idx = RESOLVERS.indexOf(resolver);
    if (idx >= 0) {
      RESOLVERS.splice(idx, 1);
    }
  };
}

export { GradleResolver } from './gradle/index.js';
export { MavenResolver } from './maven/index.js';
export type {
  ArtifactCoordinates,
  BuildCacheInputs,
  BuildSystemInfo,
  DependencyResolver,
  InterprojectRef,
  ResolutionError,
  ResolutionOutput,
  ResolutionParseResult,
  ResolutionResult,
  ResolveOptions,
  ResolvePhaseInfo,
  ResolveSourcesJarResult,
  ResolvedArtifact,
  ResolvedConfiguration,
  ResolvedModule,
  SubprocessCapture,
  SubprocessHooks,
} from './base.js';

export { SUPPORTED_RESOLUTION_SCHEMA_VERSIONS } from './base.js';
