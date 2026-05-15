import { createCliProgressReporter } from './cli-progress.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';
import type { ArtifactCoordinates, ClassSourceLookupResult } from './extractor/class-source-types.js';
import { extractExternalClassSource } from './extractor/extract-external-class-source.js';
import type { GradleProcessCapture, ResolveOptions } from './resolvers/base.js';
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

function subprocessFromGradle(g: GradleProcessCapture | undefined) {
  if (!g) {
    return undefined;
  }
  return {
    command: g.command,
    exitCode: g.exitCode,
    stdout: g.stdout,
    stderr: g.stderr,
  };
}

function commonInput(opts: GetClassSourceOptions, className: string): Record<string, unknown> {
  return {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
    forceRefresh: opts.forceRefresh,
  };
}

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
      diagnosticOperation: 'get_class_source',
    });
    if (!resolved.ok) {
      return {
        ok: false,
        error: {
          code: 'RESOLUTION_FAILED',
          message: resolved.message,
          stderr: resolved.stderr,
        },
        ...(resolved.diagnosticId !== undefined ? { diagnosticId: resolved.diagnosticId, hint: resolved.hint } : {}),
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
          gradle: result.gradle,
        });
      }
      const path = result.sourcesJarPath;
      sourcesJarCache.set(key, path);
      return path;
    };

    let extracted: ClassSourceLookupResult;
    try {
      extracted = await extractExternalClassSource(resolved.output, {
        className,
        modulePath: opts.modulePath,
        configuration: opts.configuration,
        includeTest: opts.includeTest,
        resolveSourcesJar: resolveSourcesJarFn,
        onBeforeDecompile: progressEnabled ? () => reporter.update('Decompiling with CFR…') : undefined,
      });
    } catch (e) {
      const err = e as {
        code?: string;
        message?: string;
        stderr?: string;
        coordinates?: ArtifactCoordinates;
        gradle?: GradleProcessCapture;
      };
      if (err.code === 'SOURCES_RESOLVE_FAILED') {
        const diag = recordFailureDiagnostic({
          operation: 'get_class_source',
          publicCode: 'SOURCES_RESOLVE_FAILED',
          message: err.message ?? 'Failed to resolve sources JAR',
          projectRoot: opts.projectRoot,
          buildSystem: 'gradle',
          input: commonInput(opts, className),
          subprocess: subprocessFromGradle(err.gradle),
        });
        return {
          ok: false,
          error: {
            code: 'SOURCES_RESOLVE_FAILED',
            message: err.message ?? 'Failed to resolve sources JAR',
            stderr: err.stderr,
            coordinates: err.coordinates!,
          },
          ...diag,
        };
      }
      throw e;
    }

    if (!extracted.ok) {
      const e = extracted.error;
      const subprocess =
        e.code === 'DECOMPILE_FAILED' && e.command && e.command.length > 0
          ? {
              command: e.command,
              exitCode: null as number | null,
              stdout: '',
              stderr: e.stderr ?? '',
            }
          : undefined;
      const diag = recordFailureDiagnostic({
        operation: 'get_class_source',
        publicCode: e.code,
        message: e.message,
        projectRoot: opts.projectRoot,
        buildSystem: 'gradle',
        input: commonInput(opts, className),
        subprocess,
      });
      return { ...extracted, ...diag };
    }

    return extracted;
  } finally {
    reporter.finalize();
  }
}
