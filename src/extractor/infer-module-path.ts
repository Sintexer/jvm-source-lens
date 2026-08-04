import type { ClassSourceError, ClassSourceLookupOptions } from './class-source-types.js';
import { findClasspathOwningClass } from './find-external-class-jar.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';

export type InferModulePathOptions = Pick<
  ClassSourceLookupOptions,
  'className' | 'modulePath' | 'configuration' | 'includeTest'
>;

export type InferModulePathResult =
  | { kind: 'use'; modulePath: string; inferred: boolean }
  | { kind: 'ambiguous'; modulePaths: string[] }
  | { kind: 'none'; moduleNames: string[]; searchedArtifactCount: number };

export function listModuleNames(output: ResolutionOutput): string[] {
  return output.modules.map((m) => m.name);
}

/**
 * When `modulePath` is explicit, this is a pass-through (no scanning). Otherwise probes every
 * resolved module's classpath via {@link findClasspathOwningClass} and reports the unique owner,
 * every owner (ambiguous), or none (with all module names for the caller to suggest as a retry).
 */
export function inferModulePath(
  output: ResolutionOutput,
  opts: InferModulePathOptions,
): InferModulePathResult {
  if (opts.modulePath !== undefined && opts.modulePath.length > 0) {
    return { kind: 'use', modulePath: opts.modulePath, inferred: false };
  }

  const owners: string[] = [];
  let searchedArtifactCount = 0;

  for (const module of output.modules) {
    const probe = findClasspathOwningClass(output, {
      className: opts.className,
      modulePath: module.name,
      configuration: opts.configuration,
      includeTest: opts.includeTest,
    });
    if (probe.ok) {
      owners.push(module.name);
      searchedArtifactCount += probe.hit.searchedArtifactCount;
      continue;
    }
    if (probe.error.code === 'CLASS_NOT_FOUND') {
      searchedArtifactCount += probe.error.searchedArtifactCount;
    }
    // MODULE_NOT_FOUND / CONFIGURATION_NOT_FOUND / other: this module doesn't support the
    // requested scope (e.g. no testCompileClasspath) — skip it rather than fail the whole probe.
  }

  if (owners.length === 1) {
    return { kind: 'use', modulePath: owners[0]!, inferred: true };
  }
  if (owners.length > 1) {
    return { kind: 'ambiguous', modulePaths: owners };
  }
  return { kind: 'none', moduleNames: listModuleNames(output), searchedArtifactCount };
}

export type ResolveModuleScopeResult =
  | { ok: true; modulePath: string; inferred: boolean }
  | { ok: false; error: ClassSourceError };

/**
 * Wraps {@link inferModulePath} into a `ClassSourceError`-shaped result for getters: `ambiguous`
 * becomes `MODULE_AMBIGUOUS`, `none` becomes a bare `CLASS_NOT_FOUND` (callers should enrich it
 * with `enrichClassNotFound` for `suggestedModulePaths` / `suggestions` before returning).
 */
export function resolveModuleScopeOrError(
  output: ResolutionOutput,
  opts: InferModulePathOptions,
): ResolveModuleScopeResult {
  const inferred = inferModulePath(output, opts);
  switch (inferred.kind) {
    case 'use':
      return { ok: true, modulePath: inferred.modulePath, inferred: inferred.inferred };
    case 'ambiguous':
      return {
        ok: false,
        error: {
          code: 'MODULE_AMBIGUOUS',
          message:
            `Class ${JSON.stringify(opts.className)} was found on ${inferred.modulePaths.length} modules ` +
            `(${inferred.modulePaths.join(', ')}); modulePath is required to disambiguate.`,
          modulePaths: inferred.modulePaths,
          className: opts.className,
        },
      };
    case 'none':
      return {
        ok: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message:
            `Class not found on any resolved module's classpath (${inferred.searchedArtifactCount} classpath ` +
            `edge(s) checked across ${inferred.moduleNames.length} module(s)). Verify the fully-qualified name, ` +
            'or pass modulePath explicitly.',
          className: opts.className,
          searchedArtifactCount: inferred.searchedArtifactCount,
        },
      };
  }
}
