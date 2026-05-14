import type { ClassSourceLookupResult } from './extractor/class-source-types.js';
import { extractExternalClassSource } from './extractor/extract-external-class-source.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

export type GetClassSourceOptions = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
};

/**
 * Resolves the project (with resolution cache), then looks up Java source for
 * an external dependency class on the selected classpath configuration.
 */
export async function getClassSource(
  className: string,
  opts: GetClassSourceOptions,
): Promise<ClassSourceLookupResult> {
  const resolved = await resolveWithResolutionCache(opts.projectRoot, {
    forceRefresh: Boolean(opts.forceRefresh),
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
  return extractExternalClassSource(resolved.output, {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
}
