import { createCliProgressReporter } from './cli-progress.js';
import type { ArtifactCoordinates, ClassSourceLookupResult } from './extractor/class-source-types.js';
import { extractExternalClassSource } from './extractor/extract-external-class-source.js';
import type { ResolveOptions } from './resolvers/base.js';
import { resolveSourcesJar } from './resolvers/gradle/resolve-sources-jar.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

export type GetClassSourceCliOptions = {
  /** stderr phase labels (TTY: in-place updating line). */
  progress?: boolean;
  /** Stream Gradle stderr during dependency resolution / sources JAR fetch. */
  verboseGradle?: boolean;
};

export type GetClassSourceOptions = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
  /** CLI-only: progress labels and Gradle verbose stderr. */
  cli?: GetClassSourceCliOptions;
};

function coordinatesKey(c: ArtifactCoordinates): string {
  return `${c.group}:${c.name}:${c.version ?? ''}`;
}

/**
 * Resolves the project (with resolution cache), then looks up Java source for
 * an external dependency class on the selected classpath configuration.
 * Sources JARs are fetched on demand for the single artifact that owns the class.
 */
export async function getClassSource(
  className: string,
  opts: GetClassSourceOptions,
): Promise<ClassSourceLookupResult> {
  const cli = opts.cli;
  const progressEnabled = Boolean(cli?.progress);
  const verboseGradle = Boolean(cli?.verboseGradle);
  const reporter = createCliProgressReporter(progressEnabled);

  let resolveOpts: ResolveOptions | undefined;
  if (verboseGradle) {
    resolveOpts = { inheritGradleStderr: true };
  } else if (progressEnabled) {
    resolveOpts = {
      onBeforeGradle: () => reporter.update('Resolving dependencies (Gradle)…'),
      onAfterGradle: () => reporter.finishPhase(),
    };
  }

  try {
    const resolved = await resolveWithResolutionCache(opts.projectRoot, {
      forceRefresh: Boolean(opts.forceRefresh),
      resolveOptions: resolveOpts,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        error: {
          code: 'RESOLUTION_FAILED',
          message: resolved.message,
          stderr: resolved.stderr,
        },
      };
    }

    const sourcesJarCache = new Map<string, string | null>();

    const resolveSourcesJarFn = async (coordinates: ArtifactCoordinates): Promise<string | null> => {
      const key = coordinatesKey(coordinates);
      if (sourcesJarCache.has(key)) {
        return sourcesJarCache.get(key) ?? null;
      }
      const gradleHooks =
        verboseGradle
          ? { inheritStderr: true as const }
          : progressEnabled
            ? {
                onBeforeGradle: () => reporter.update('Resolving sources JAR (Gradle)…'),
                onAfterGradle: () => reporter.finishPhase(),
              }
            : undefined;
      const result = await resolveSourcesJar(opts.projectRoot, coordinates, gradleHooks);
      if (!result.ok) {
        throw Object.assign(new Error(result.message), {
          code: 'SOURCES_RESOLVE_FAILED' as const,
          stderr: result.stderr,
          coordinates,
        });
      }
      const path = result.sourcesJarPath;
      sourcesJarCache.set(key, path);
      return path;
    };

    try {
      return await extractExternalClassSource(resolved.output, {
        className,
        modulePath: opts.modulePath,
        configuration: opts.configuration,
        includeTest: opts.includeTest,
        resolveSourcesJar: resolveSourcesJarFn,
        onBeforeDecompile: progressEnabled ? () => reporter.update('Decompiling with CFR…') : undefined,
      });
    } catch (e) {
      const err = e as { code?: string; message?: string; stderr?: string; coordinates?: ArtifactCoordinates };
      if (err.code === 'SOURCES_RESOLVE_FAILED') {
        return {
          ok: false,
          error: {
            code: 'SOURCES_RESOLVE_FAILED',
            message: err.message ?? 'Failed to resolve sources JAR',
            stderr: err.stderr,
            coordinates: err.coordinates!,
          },
        };
      }
      throw e;
    }
  } finally {
    reporter.finalize();
  }
}
