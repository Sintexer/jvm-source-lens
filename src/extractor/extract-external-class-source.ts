import type { ArtifactCoordinates, ClassSourceLookupOptions, ClassSourceLookupResult } from './class-source-types.js';
import { isExternalJarArtifact } from './class-source-types.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { readZipEntryUtf8, zipEntryExists } from './zip-entry.js';

function tryReadSourceFromJar(
  sourcesJarPath: string,
  sourceRelPath: string,
  className: string,
  coordinates: ArtifactCoordinates,
): ClassSourceLookupResult | null {
  const r = readZipEntryUtf8(sourcesJarPath, sourceRelPath);
  if (r.ok) {
    return {
      ok: true,
      source: r.text,
      sourceAvailable: true,
      className,
      provenance: {
        kind: 'sourcesJar',
        coordinates,
        jarPath: sourcesJarPath,
      },
    };
  }
  if (r.reason === 'error') {
    return { ok: false, error: r.error };
  }
  return null;
}

/**
 * Locates Java source for an external dependency class from a pre-resolved
 * classpath. Sources JARs are not bulk-fetched at resolve time; pass
 * `resolveSourcesJar` to download/read sources only for the winning artifact.
 */
export async function extractExternalClassSource(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): Promise<ClassSourceLookupResult> {
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
    const coordinates: ArtifactCoordinates = {
      group: a.group,
      name: a.name,
      version: a.version,
    };

    if (a.sourcesJarPath !== null && a.sourcesJarPath.length > 0) {
      const fromCached = tryReadSourceFromJar(
        a.sourcesJarPath,
        paths.sourceRelPath,
        opts.className,
        coordinates,
      );
      if (fromCached !== null) {
        return fromCached;
      }
    }

    if (a.jarPath === null || a.jarPath.length === 0) {
      continue;
    }

    const pres = zipEntryExists(a.jarPath, paths.classRelPath);
    if (!pres.ok) {
      return { ok: false, error: pres.error };
    }
    if (!pres.exists) {
      continue;
    }

    let sourcesJarPath = a.sourcesJarPath;
    if ((sourcesJarPath === null || sourcesJarPath.length === 0) && opts.resolveSourcesJar) {
      sourcesJarPath = await opts.resolveSourcesJar(coordinates);
    }

    if (sourcesJarPath !== null && sourcesJarPath.length > 0) {
      const fromResolved = tryReadSourceFromJar(
        sourcesJarPath,
        paths.sourceRelPath,
        opts.className,
        coordinates,
      );
      if (fromResolved !== null) {
        return fromResolved;
      }
    }

    return {
      ok: false,
      error: {
        code: 'DECOMPILE_NOT_IMPLEMENTED',
        message:
          'Class found as bytecode only; CFR decompilation is not implemented yet. Use a dependency that publishes a sources JAR, or wait for decompiler support.',
        className: opts.className,
        jarPath: a.jarPath,
        entryRelPath: paths.classRelPath,
        coordinates,
      },
    };
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
