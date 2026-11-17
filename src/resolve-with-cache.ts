import type { DependencyResolver, ResolutionResult, ResolveOptions } from './resolvers/base.js';
import { detectResolver, UnsupportedProjectError } from './resolvers/index.js';
import {
  computeBuildInputsDigest,
  readCachedResolution,
  writeCachedResolution,
} from './cache/index.js';
import { canonicalProjectRoot } from './cache/paths.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';

export type ResolveWithResolutionCacheOptions = {
  forceRefresh: boolean;
  /**
   * Test override: skips `detectResolver` and uses this resolver instead.
   *
   * @internal
   */
  resolver?: DependencyResolver;
  /** Passed through to `resolver.resolve` (subprocess hooks / verbose stderr). */
  resolveOptions?: ResolveOptions;
  /** Used in structured diagnostics (default `resolve_dependencies`). */
  diagnosticOperation?: string;
};

const defaultOptions: ResolveWithResolutionCacheOptions = { forceRefresh: false };

/**
 * Returns cached `ResolutionOutput` when build-input digest matches and `forceRefresh` is false;
 * otherwise invokes the detected resolver and refreshes the global disk cache on success.
 */
export async function resolveWithResolutionCache(
  projectRoot: string,
  options?: Partial<ResolveWithResolutionCacheOptions>,
): Promise<ResolutionResult> {
  const forceRefresh = options?.forceRefresh ?? defaultOptions.forceRefresh;
  const canonical = canonicalProjectRoot(projectRoot);
  const diagnosticOp = options?.diagnosticOperation ?? 'resolve_dependencies';

  let resolver: DependencyResolver;
  try {
    resolver = options?.resolver ?? detectResolver(canonical);
  } catch (e) {
    const message =
      e instanceof UnsupportedProjectError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    const diag = recordFailureDiagnostic({
      operation: diagnosticOp,
      publicCode: 'RESOLUTION_FAILED',
      message,
      projectRoot: canonical,
      buildSystem: null,
      input: { forceRefresh },
    });
    return { ok: false, message, ...diag };
  }

  if (!forceRefresh) {
    const cached = readCachedResolution(canonical, resolver);
    if (cached.ok) {
      return { ok: true, output: cached.output };
    }
  }

  const result = await resolver.resolve(canonical, options?.resolveOptions);

  if (result.ok) {
    const digest = computeBuildInputsDigest(canonical, resolver);
    const written = writeCachedResolution(canonical, result.output, digest, resolver);
    if (!written.ok) {
      const diag = recordFailureDiagnostic({
        operation: diagnosticOp,
        publicCode: 'CACHE_WRITE_FAILED',
        message: written.message,
        projectRoot: canonical,
        buildSystem: result.output.buildSystem.type,
        input: { forceRefresh },
      });
      return { ok: false, message: written.message, ...diag };
    }
  } else {
    const diag = recordFailureDiagnostic({
      operation: diagnosticOp,
      publicCode: 'RESOLUTION_FAILED',
      message: result.message,
      projectRoot: canonical,
      buildSystem: resolver.id,
      input: { forceRefresh },
      subprocess: result.subprocess
        ? {
            command: result.subprocess.command,
            exitCode: result.subprocess.exitCode,
            stdout: result.subprocess.stdout,
            stderr: result.subprocess.stderr,
          }
        : undefined,
    });
    return {
      ok: false,
      message: result.message,
      stderr: result.stderr,
      subprocess: result.subprocess,
      ...diag,
    };
  }

  return result;
}
