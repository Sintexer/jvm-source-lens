import { existsSync } from 'node:fs';
import type { ClassSourceError, ClassSourceLookupOptions } from './class-source-types.js';
import { findClasspathOwningClass, type ClasspathOwningClassHit } from './find-external-class-jar.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { candidateInterprojectJavaSourcePaths } from './interproject-paths.js';
import { matchModule, withoutAllModules } from './match-module.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';

export type InferModulePathOptions = Pick<
  ClassSourceLookupOptions,
  'className' | 'modulePath' | 'configuration' | 'includeTest'
>;

export type InferModulePathResult =
  | { kind: 'use'; modulePath: string; inferred: boolean }
  | { kind: 'ambiguous'; modulePaths: string[]; providers: ModuleProvider[] }
  | { kind: 'none'; moduleNames: string[]; searchedArtifactCount: number };

/** Which artifact a module's classpath uses for the class, as a short human label (version or module). */
export type ModuleProvider = { modulePath: string; label: string };

function hitIdentity(hit: ClasspathOwningClassHit): string {
  if (hit.kind === 'interprojectBytecode') {
    return `interproject:${hit.moduleName}`;
  }
  const c = hit.coordinates;
  return `${c.group}:${c.name}:${c.version ?? ''}|${hit.artifact.jarPath ?? ''}`;
}

function hitLabel(hit: ClasspathOwningClassHit): string {
  if (hit.kind === 'interprojectBytecode') {
    return `project ${hit.moduleName}`;
  }
  const c = hit.coordinates;
  return `${c.group}:${c.name}${c.version ? `:${c.version}` : ''}`;
}

export function listModuleNames(output: ResolutionOutput): string[] {
  return output.modules.map((m) => m.name);
}

/** One module's view of the wanted class: which artifact provides it. */
export type ClassOwner = { modulePath: string; identity: string; label: string; searchedArtifactCount: number };

type ProbeScope = Pick<ClassSourceLookupOptions, 'className' | 'configuration' | 'includeTest'>;

/** Inter-project classes are often source-only (no `build/classes` yet), so also look for the `.java`. */
function probeJavaSourceOwner(
  output: ResolutionOutput,
  moduleName: string,
  opts: ProbeScope,
): Omit<ClassOwner, 'searchedArtifactCount'> | null {
  const paths = fqnToZipRelPaths(opts.className);
  if (!paths.ok) {
    return null;
  }
  const picked = pickResolvedConfiguration(output, {
    modulePath: moduleName,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!picked.ok) {
    return null;
  }
  const includeTest = Boolean(opts.includeTest);
  const hasSource = (root: string): boolean =>
    candidateInterprojectJavaSourcePaths(root, paths.sourceRelPath, includeTest).some((p) => existsSync(p));
  const owned = (name: string) => ({
    modulePath: moduleName,
    identity: `interproject:${name}`,
    label: `project ${name}`,
  });
  if (hasSource(picked.module.path)) {
    return owned(picked.module.name);
  }
  for (const a of picked.configuration.artifacts) {
    if (a.origin === 'interproject' && a.interproject && hasSource(a.interproject.modulePath)) {
      return owned(a.interproject.moduleName);
    }
  }
  return null;
}

/**
 * Does `moduleName`'s classpath (bytecode or inter-project source) provide the class?
 * Returns `null` when it does not, or when the module / configuration cannot be picked.
 */
export function probeClassOwner(
  output: ResolutionOutput,
  moduleName: string,
  opts: ProbeScope,
): { owner: ClassOwner } | { owner: null; searchedArtifactCount: number } {
  const probe = findClasspathOwningClass(output, { ...opts, modulePath: moduleName });
  if (probe.ok) {
    return {
      owner: {
        modulePath: moduleName,
        identity: hitIdentity(probe.hit),
        label: hitLabel(probe.hit),
        searchedArtifactCount: probe.hit.searchedArtifactCount,
      },
    };
  }
  const bySource = probeJavaSourceOwner(output, moduleName, opts);
  if (bySource !== null) {
    return { owner: { ...bySource, searchedArtifactCount: 0 } };
  }
  // MODULE_NOT_FOUND / CONFIGURATION_NOT_FOUND / other: this module doesn't support the
  // requested scope (e.g. no testCompileClasspath) — skip it rather than fail the whole probe.
  return {
    owner: null,
    searchedArtifactCount: probe.error.code === 'CLASS_NOT_FOUND' ? probe.error.searchedArtifactCount : 0,
  };
}

/**
 * When `modulePath` is explicit, this is a pass-through (no scanning). Otherwise probes every
 * resolved module's classpath via {@link findClasspathOwningClass} and reports the unique owner,
 * every owner (ambiguous), or none (with all module names for the caller to suggest as a retry).
 */
export function inferModulePath(
  output: ResolutionOutput,
  rawOpts: InferModulePathOptions,
): InferModulePathResult {
  const opts = withoutAllModules(rawOpts);
  if (opts.modulePath !== undefined && opts.modulePath.length > 0) {
    // Canonicalize loose input (`app`, `/app`) so responses echo the real Gradle path; unmatched
    // input passes through and pickResolvedConfiguration reports MODULE_NOT_FOUND with candidates.
    const match = matchModule(opts.modulePath, output.modules, output.projectRoot);
    return {
      kind: 'use',
      modulePath: match.kind === 'match' ? match.module.name : opts.modulePath,
      inferred: false,
    };
  }

  const owners: ClassOwner[] = [];
  let searchedArtifactCount = 0;

  for (const module of output.modules) {
    const probe = probeClassOwner(output, module.name, opts);
    if (probe.owner !== null) {
      owners.push(probe.owner);
      searchedArtifactCount += probe.owner.searchedArtifactCount;
    } else {
      searchedArtifactCount += probe.searchedArtifactCount;
    }
  }

  if (owners.length > 0 && new Set(owners.map((o) => o.identity)).size === 1) {
    // Every module that sees the class sees the same artifact: no real ambiguity, just answer.
    return { kind: 'use', modulePath: owners[0]!.modulePath, inferred: true };
  }
  if (owners.length > 1) {
    return {
      kind: 'ambiguous',
      modulePaths: owners.map((o) => o.modulePath),
      providers: owners.map((o) => ({ modulePath: o.modulePath, label: o.label })),
    };
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
    case 'ambiguous': {
      const listed = inferred.providers.map((p) => `${p.modulePath} (${p.label})`).join(', ');
      const retry = inferred.providers.map((p) => `modulePath=${JSON.stringify(p.modulePath)}`).join(' or ');
      return {
        ok: false,
        error: {
          code: 'MODULE_AMBIGUOUS',
          message:
            `Class ${JSON.stringify(opts.className)} resolves to different artifacts per module: ${listed}. ` +
            `Retry with ${retry}.`,
          modulePaths: inferred.modulePaths,
          className: opts.className,
        },
      };
    }
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
