import type { ArtifactCoordinates } from './extractor/class-source-types.js';
import { FailureSeverity } from './diagnostics/failure-severity.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';
import type {
  DependencyResolver,
  ResolveSourcesJarResult,
  SubprocessHooks,
} from './resolvers/base.js';
import { resolverById } from './resolvers/index.js';

export type SourcesJarResolverParams = {
  projectRoot: string;
  /** Build system id from `ResolutionOutput.buildSystem.type` (e.g. `'gradle'`). */
  buildSystem: string;
  /** Diagnostic operation name (e.g. `get_class_source`). */
  operation: string;
  /** Raw tool input; sanitized by the diagnostics layer. */
  input: Record<string, unknown>;
  hooks?: SubprocessHooks;
  /** Distinguish a failed transfer from a genuine miss without breaking bytecode fallback. */
  onLookupFailure?: () => void;
  /** Optional explicit resolver override (otherwise looked up via `resolverById(buildSystem)`). */
  resolver?: DependencyResolver;
  /** Injection point for tests. */
  resolveSourcesJar?: (
    projectRoot: string,
    coordinates: ArtifactCoordinates,
    hooks?: SubprocessHooks,
  ) => Promise<ResolveSourcesJarResult>;
};

function coordinatesKey(c: ArtifactCoordinates): string {
  return `${c.group}:${c.name}:${c.version ?? ''}`;
}

/**
 * Per-request sources-JAR resolver, memoized by coordinates.
 *
 * A failed build-tool lookup is **not** fatal: it is recorded as a diagnostic and treated as
 * "no sources JAR", so callers fall back to CFR decompilation / bytecode instead of failing the
 * request.
 */
export function createSourcesJarResolver(
  params: SourcesJarResolverParams,
): (coordinates: ArtifactCoordinates) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (coordinates) => {
    const key = coordinatesKey(coordinates);
    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }

    let result: ResolveSourcesJarResult;
    if (params.resolveSourcesJar) {
      result = await params.resolveSourcesJar(params.projectRoot, coordinates, params.hooks);
    } else {
      const resolver = params.resolver ?? resolverById(params.buildSystem);
      if (!resolver) {
        cache.set(key, null);
        return null;
      }
      result = await resolver.resolveSourcesJar(params.projectRoot, coordinates, params.hooks);
    }

    if (!result.ok) {
      params.onLookupFailure?.();
      recordFailureDiagnostic({
        operation: params.operation,
        publicCode: 'SOURCES_RESOLVE_FAILED',
        message: result.message,
        projectRoot: params.projectRoot,
        buildSystem: params.buildSystem,
        input: params.input,
        subprocess: result.subprocess,
      });
      cache.set(key, null);
      return null;
    }
    if (result.sourcesJarPath === null && result.reason !== undefined) {
      // Expected for libraries without a published -sources.jar: one log line, no snapshot file.
      recordFailureDiagnostic({
        operation: params.operation,
        publicCode: 'SOURCES_RESOLVE_FAILED',
        message: `No sources JAR for ${coordinatesKey(coordinates)}: ${result.reason}`,
        projectRoot: params.projectRoot,
        buildSystem: params.buildSystem,
        input: params.input,
        forceSeverity: FailureSeverity.EXPECTED,
      });
    }
    cache.set(key, result.sourcesJarPath);
    return result.sourcesJarPath;
  };
}
