import type { ArtifactCoordinates } from './extractor/class-source-types.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';
import {
  resolveSourcesJar as defaultResolveSourcesJar,
  type ResolveSourcesJarGradleOptions,
} from './resolvers/gradle/resolve-sources-jar.js';

export type SourcesJarResolverParams = {
  projectRoot: string;
  /** Diagnostic operation name (e.g. `get_class_source`). */
  operation: string;
  /** Raw tool input; sanitized by the diagnostics layer. */
  input: Record<string, unknown>;
  gradle?: ResolveSourcesJarGradleOptions;
  /** Injection point for tests. */
  resolveSourcesJar?: typeof defaultResolveSourcesJar;
};

function coordinatesKey(c: ArtifactCoordinates): string {
  return `${c.group}:${c.name}:${c.version ?? ''}`;
}

/**
 * Per-request sources-JAR resolver, memoized by coordinates.
 *
 * A failed Gradle lookup is **not** fatal: it is recorded as a diagnostic and treated as
 * "no sources JAR", so callers fall back to CFR decompilation / bytecode instead of failing the
 * request (the agent used to retry the same failing call).
 */
export function createSourcesJarResolver(
  params: SourcesJarResolverParams,
): (coordinates: ArtifactCoordinates) => Promise<string | null> {
  const resolveJar = params.resolveSourcesJar ?? defaultResolveSourcesJar;
  const cache = new Map<string, string | null>();
  return async (coordinates) => {
    const key = coordinatesKey(coordinates);
    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }
    const result = await resolveJar(params.projectRoot, coordinates, params.gradle);
    if (!result.ok) {
      recordFailureDiagnostic({
        operation: params.operation,
        publicCode: 'SOURCES_RESOLVE_FAILED',
        message: result.message,
        projectRoot: params.projectRoot,
        buildSystem: 'gradle',
        input: params.input,
        subprocess: result.gradle,
      });
      cache.set(key, null);
      return null;
    }
    cache.set(key, result.sourcesJarPath);
    return result.sourcesJarPath;
  };
}
