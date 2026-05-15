import { createHash } from 'node:crypto';
import { computeBuildInputsDigest } from '../cache/index.js';
import { canonicalProjectRoot } from '../cache/paths.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import type { ResolvedConfiguration, ResolvedModule } from '../resolvers/resolution-output.js';
import { buildClassSearchIndex } from './build-class-search-index.js';
import { readClassSearchIndex, writeClassSearchIndex } from './class-search-index-cache.js';
import type { ClassSearchIndexFileV1 } from './types.js';

export function resolutionFingerprint(output: ResolutionOutput): string {
  return createHash('sha256').update(JSON.stringify(output), 'utf8').digest('hex');
}

export type EnsureClassSearchIndexScope = {
  module: ResolvedModule;
  configuration: ResolvedConfiguration;
  includeTest: boolean;
};

/**
 * Returns a cached index when meta matches current build inputs, resolution content, and classpath scope; otherwise rebuilds and persists.
 */
export function ensureClassSearchIndex(
  projectRoot: string,
  output: ResolutionOutput,
  scope: EnsureClassSearchIndexScope,
): { ok: true; file: ClassSearchIndexFileV1 } | { ok: false; message: string } {
  const canonical = canonicalProjectRoot(projectRoot);
  const buildInputsDigest = computeBuildInputsDigest(canonical);
  const fp = resolutionFingerprint(output);

  const cached = readClassSearchIndex(canonical);
  if (cached.ok) {
    const { meta } = cached.file;
    if (
      meta.buildInputsDigest === buildInputsDigest &&
      meta.resolutionFingerprint === fp &&
      meta.moduleName === scope.module.name &&
      meta.configurationName === scope.configuration.name &&
      meta.includeTest === scope.includeTest
    ) {
      return { ok: true, file: cached.file };
    }
  }

  const built = buildClassSearchIndex({
    module: scope.module,
    configuration: scope.configuration,
    includeTest: scope.includeTest,
    buildInputsDigest,
    resolutionFingerprint: fp,
  });
  if (!built.ok) {
    return built;
  }

  const written = writeClassSearchIndex(canonical, built.file);
  if (!written.ok) {
    return { ok: false, message: written.message };
  }

  return { ok: true, file: built.file };
}
