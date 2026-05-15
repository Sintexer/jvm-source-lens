import { decompileExternalClass } from '../decompiler/decompile-external-class.js';
import type { ArtifactCoordinates, ClassSourceLookupOptions, ClassSourceLookupResult } from './class-source-types.js';
import { isClasspathBinaryJarArtifact, isExternalJarArtifact } from './class-source-types.js';
import { findExternalJarAmongArtifacts } from './find-external-class-jar.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { readInterprojectJavaIfPresent } from './read-interproject-java-source.js';
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

  for (const edge of picked.configuration.artifacts) {
    const ip = await readInterprojectJavaIfPresent(
      edge,
      paths.sourceRelPath,
      opts.className,
      Boolean(opts.includeTest),
    );
    if (ip !== null) {
      return ip;
    }
  }

  for (const a of picked.configuration.artifacts) {
    if (a.origin === 'interproject') {
      continue;
    }
    const sj = a.sourcesJarPath ?? null;
    if (sj === null || sj.length === 0) {
      continue;
    }
    const coordinates: ArtifactCoordinates = {
      group: a.group,
      name: a.name,
      version: a.version,
    };
    const fromCached = tryReadSourceFromJar(sj, paths.sourceRelPath, opts.className, coordinates);
    if (fromCached !== null) {
      return fromCached;
    }
  }

  const artifacts = picked.configuration.artifacts.filter(isClasspathBinaryJarArtifact);
  const searchedArtifactCount = artifacts.length;

  const jarHit = findExternalJarAmongArtifacts(artifacts, paths.classRelPath, opts.className);
  if (!jarHit.ok) {
    return jarHit;
  }

  const { hit } = jarHit;
  const a = hit.artifact;
  const coordinates = hit.coordinates;

  let sourcesJarPath = a.sourcesJarPath ?? null;
  if (
    (sourcesJarPath === null || sourcesJarPath.length === 0) &&
    opts.resolveSourcesJar &&
    isExternalJarArtifact(a)
  ) {
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
    jarPath: hit.classpath,
    entryRelPath: paths.classRelPath,
    coordinates,
    onBeforeCfr: opts.onBeforeDecompile,
  });
  if (decompiled.ok) {
    return decompiled;
  }
  return { ok: false, error: decompiled.error };
}
