import type { ClassSourceLookupOptions, ClassSourceLookupResult } from './class-source-types.js';
import { isExternalJarArtifact } from './class-source-types.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { readZipEntryUtf8, zipEntryExists } from './zip-entry.js';

/**
 * Locates Java source for an external dependency class from a pre-resolved
 * classpath. Interproject modules and CFR decompilation are not handled here.
 */
export function extractExternalClassSource(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): ClassSourceLookupResult {
  const picked = pickResolvedConfiguration(output, {
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!picked.ok) {
    return { ok: false, error: picked.error };
  }

  const paths = fqnToZipRelPaths(opts.className);
  if (!paths.ok) {
    return { ok: false, error: paths.error };
  }

  const artifacts = picked.configuration.artifacts.filter(isExternalJarArtifact);
  const searchedArtifactCount = artifacts.length;

  for (const a of artifacts) {
    if (a.sourcesJarPath !== null && a.sourcesJarPath.length > 0) {
      const r = readZipEntryUtf8(a.sourcesJarPath, paths.sourceRelPath);
      if (r.ok) {
        return {
          ok: true,
          source: r.text,
          sourceAvailable: true,
          className: opts.className,
          provenance: {
            kind: 'sourcesJar',
            coordinates: { group: a.group, name: a.name, version: a.version },
            jarPath: a.sourcesJarPath,
          },
        };
      }
      if (r.reason === 'error') {
        return { ok: false, error: r.error };
      }
    }

    if (a.jarPath !== null && a.jarPath.length > 0) {
      const pres = zipEntryExists(a.jarPath, paths.classRelPath);
      if (!pres.ok) {
        return { ok: false, error: pres.error };
      }
      if (pres.exists) {
        return {
          ok: false,
          error: {
            code: 'DECOMPILE_NOT_IMPLEMENTED',
            message:
              'Class found as bytecode only; CFR decompilation is not implemented yet. Use a dependency that publishes a sources JAR, or wait for decompiler support.',
            className: opts.className,
            jarPath: a.jarPath,
            entryRelPath: paths.classRelPath,
            coordinates: { group: a.group, name: a.name, version: a.version },
          },
        };
      }
    }
  }

  return {
    ok: false,
    error: {
      code: 'CLASS_NOT_FOUND',
      message: `Class not found in external JARs on this classpath (${searchedArtifactCount} artifact(s) scanned). Interproject sources are not searched in this version.`,
      className: opts.className,
      searchedArtifactCount,
    },
  };
}
