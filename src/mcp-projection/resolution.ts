/**
 * Projection helpers for resolve_dependencies MCP tool responses.
 *
 * Default full=true JSON: summary shape — schemaVersion, resolvedAt, buildSystem,
 * projectRoot, module count, per-module config artifact counts, errors[].
 *
 * Opt-in via include:
 *   'artifacts'   → per-config artifacts[] (group, name, version, origin, direct) — no jar paths
 *   'coordinates' → alias for 'artifacts'
 *   'jarPaths'    → add jarPath / sourcesJarPath to artifacts (requires 'artifacts')
 *   'errors'      → always present in default; explicit token for clarity
 *   'all'         → full ResolutionOutput (current behavior before this change)
 */

import type { ResolutionOutput, ResolvedModule, ResolvedArtifact } from '../resolvers/resolution-output.js';

export type ResolutionIncludeSection = 'artifacts' | 'coordinates' | 'jarPaths' | 'errors' | 'all';

function wantsResolutionInclude(include: ResolutionIncludeSection[] | undefined, s: ResolutionIncludeSection): boolean {
  if (!include || include.length === 0) return false;
  return include.includes('all') || include.includes(s);
}

export type ProjectedArtifact = {
  group: string;
  name: string;
  version: string | null;
  origin: ResolvedArtifact['origin'];
  direct: boolean;
  jarPath?: string | null;
  sourcesJarPath?: string | null;
};

export type ProjectedConfigSummary = {
  name: string;
  scope: string;
  artifactCount: number;
  directCount: number;
  artifacts?: ProjectedArtifact[];
};

export type ProjectedModuleSummary = {
  name: string;
  path: string;
  configurations: ProjectedConfigSummary[];
};

export type ProjectedResolution = {
  ok: true;
  schemaVersion: string;
  resolvedAt: string;
  buildSystem: ResolutionOutput['buildSystem'];
  projectRoot: string;
  moduleCount: number;
  modules: ProjectedModuleSummary[];
  errors: ResolutionOutput['errors'];
};

function projectArtifact(a: ResolvedArtifact, withPaths: boolean): ProjectedArtifact {
  const p: ProjectedArtifact = {
    group: a.group,
    name: a.name,
    version: a.version,
    origin: a.origin,
    direct: a.direct,
  };
  if (withPaths) {
    p.jarPath = a.jarPath;
    if (a.sourcesJarPath !== undefined) {
      p.sourcesJarPath = a.sourcesJarPath;
    }
  }
  return p;
}

function projectModule(m: ResolvedModule, withArtifacts: boolean, withPaths: boolean): ProjectedModuleSummary {
  return {
    name: m.name,
    path: m.path,
    configurations: m.configurations.map((c) => {
      const summary: ProjectedConfigSummary = {
        name: c.name,
        scope: c.scope,
        artifactCount: c.artifacts.length,
        directCount: c.artifacts.filter((a) => a.direct).length,
      };
      if (withArtifacts) {
        summary.artifacts = c.artifacts.map((a) => projectArtifact(a, withPaths));
      }
      return summary;
    }),
  };
}

/**
 * Project a ResolutionOutput into a slim JSON payload for full=true MCP responses.
 * Pass include=['all'] to get the full ResolutionOutput unchanged.
 */
export function projectResolution(
  output: ResolutionOutput,
  include?: ResolutionIncludeSection[],
): ProjectedResolution | ResolutionOutput {
  if (wantsResolutionInclude(include, 'all')) {
    return output;
  }

  const withArtifacts =
    wantsResolutionInclude(include, 'artifacts') || wantsResolutionInclude(include, 'coordinates');
  const withPaths = wantsResolutionInclude(include, 'jarPaths');

  return {
    ok: true,
    schemaVersion: output.schemaVersion,
    resolvedAt: output.resolvedAt,
    buildSystem: output.buildSystem,
    projectRoot: output.projectRoot,
    moduleCount: output.modules.length,
    modules: output.modules.map((m) => projectModule(m, withArtifacts, withPaths)),
    errors: output.errors,
  };
}
