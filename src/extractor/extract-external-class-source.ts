import { decompileExternalClass } from '../decompiler/decompile-external-class.js';
import type { ArtifactCoordinates, ClassSourceLookupOptions, ClassSourceLookupResult } from './class-source-types.js';
import { isExternalJarArtifact } from './class-source-types.js';
import { findExternalJarAmongArtifacts } from './find-external-class-jar.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { readZipEntryUtf8 } from './zip-entry.js';

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
    if (a.sourcesJarPath !== null && a.sourcesJarPath.length > 0) {
      const coordinates: ArtifactCoordinates = {
        group: a.group,
        name: a.name,
        version: a.version,
      };
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
  }

  const jarHit = findExternalJarAmongArtifacts(artifacts, paths.classRelPath, opts.className);
  if (!jarHit.ok) {
    return jarHit;
  }

  const { hit } = jarHit;
  const a = hit.artifact;
  const coordinates = hit.coordinates;

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

  const decompile = opts.decompileExternalClass ?? decompileExternalClass;
  const decompiled = await decompile({
    className: opts.className,
    jarPath: hit.jarPath,
    entryRelPath: paths.classRelPath,
    coordinates,
  });
  if (decompiled.ok) {
    return decompiled;
  }
  return { ok: false, error: decompiled.error };
}
