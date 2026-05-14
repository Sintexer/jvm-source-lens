import type { DependencyResolver, ResolutionResult } from './resolvers/base.js';
import { detectResolver } from './resolvers/index.js';
import {
  computeBuildInputsDigest,
  readCachedResolution,
  writeCachedResolution,
} from './cache/index.js';
import { canonicalProjectRoot } from './cache/paths.js';

export type ResolveWithResolutionCacheOptions = {
  forceRefresh: boolean;
  /** When set (e.g. in tests), skips `detectResolver` and uses this resolver instead. */
  resolver?: DependencyResolver;
};

const defaultOptions: ResolveWithResolutionCacheOptions = { forceRefresh: false };

/**
 * Returns cached `ResolutionOutput` when build-input digest matches and `forceRefresh` is false;
 * otherwise invokes the detected resolver (Gradle) and refreshes the global disk cache on success.
 * If persisting the cache fails after a successful resolve, returns `{ ok: false, message }` (Gradle output is not echoed in that case).
 */
export async function resolveWithResolutionCache(
  projectRoot: string,
  options?: Partial<ResolveWithResolutionCacheOptions>,
): Promise<ResolutionResult> {
  const forceRefresh = options?.forceRefresh ?? defaultOptions.forceRefresh;
  const canonical = canonicalProjectRoot(projectRoot);
  const resolver = options?.resolver ?? detectResolver(canonical);

  if (!forceRefresh) {
    const cached = readCachedResolution(canonical);
    if (cached.ok) {
      return { ok: true, output: cached.output };
    }
  }

  const result = await resolver.resolve(canonical);

  if (result.ok) {
    const digest = computeBuildInputsDigest(canonical);
    const written = writeCachedResolution(canonical, result.output, digest);
    if (!written.ok) {
      return { ok: false, message: written.message };
    }
  }

  return result;
}
