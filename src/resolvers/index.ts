import type { DependencyResolver } from './base.js';
import { GradleResolver } from './gradle/index.js';

const RESOLVERS: DependencyResolver[] = [new GradleResolver()];

export class UnsupportedProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedProjectError';
  }
}

export function detectResolver(projectRoot: string): DependencyResolver {
  const resolver = RESOLVERS.find((r) => r.detect(projectRoot));
  if (!resolver) {
    throw new UnsupportedProjectError(
      `No supported build system found in ${projectRoot}. ` +
        'Currently supported: Gradle. Contributions welcome.',
    );
  }
  return resolver;
}

export { GradleResolver } from './gradle/index.js';
export type {
  BuildSystemInfo,
  DependencyResolver,
  InterprojectRef,
  ResolutionError,
  ResolutionOutput,
  ResolutionParseResult,
  ResolutionResult,
  ResolveOptions,
  ResolvedArtifact,
  ResolvedConfiguration,
  ResolvedModule,
} from './base.js';

export { SUPPORTED_RESOLUTION_SCHEMA_VERSIONS } from './base.js';
