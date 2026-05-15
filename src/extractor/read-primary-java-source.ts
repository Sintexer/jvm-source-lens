import type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  ClassSourceLookupResult,
  SourcesJarProvenance,
} from './class-source-types.js';
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

export type TryReadPrimaryJavaSourceResult =
  | { ok: true; hit: true; sourceText: string; provenance: SourcesJarProvenance }
  | { ok: true; hit: false }
  | { ok: false; error: ClassSourceError };

/**
 * Reads `.java` from a sources JAR if available (cached path or `resolveSourcesJar`),
 * without falling back to bytecode decompilation.
 */
export async function tryReadPrimaryJavaSourceFromArtifacts(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): Promise<TryReadPrimaryJavaSourceResult> {
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

  for (const a of artifacts) {
    if (a.sourcesJarPath !== null && a.sourcesJarPath.length > 0) {
      const coordinates: ArtifactCoordinates = {
        group: a.group,
        name: a.name,
        version: a.version,
      };
      const fromCached = tryReadSourceFromJar(a.sourcesJarPath, paths.sourceRelPath, opts.className, coordinates);
      if (fromCached !== null) {
      if (!fromCached.ok) {
        return { ok: false, error: fromCached.error };
      }
      if (fromCached.provenance.kind !== 'sourcesJar') {
        return { ok: true, hit: false };
      }
      return {
        ok: true,
        hit: true,
        sourceText: fromCached.source,
        provenance: fromCached.provenance,
      };
      }
    }
  }

  const jarHit = findExternalJarAmongArtifacts(artifacts, paths.classRelPath, opts.className);
  if (!jarHit.ok) {
    return { ok: false, error: jarHit.error };
  }

  const { hit } = jarHit;
  const a = hit.artifact;
  const coordinates = hit.coordinates;

  let sourcesJarPath = a.sourcesJarPath;
  if ((sourcesJarPath === null || sourcesJarPath.length === 0) && opts.resolveSourcesJar) {
    sourcesJarPath = await opts.resolveSourcesJar(coordinates);
  }

  if (sourcesJarPath !== null && sourcesJarPath.length > 0) {
    const fromResolved = tryReadSourceFromJar(sourcesJarPath, paths.sourceRelPath, opts.className, coordinates);
    if (fromResolved !== null) {
      if (!fromResolved.ok) {
        return { ok: false, error: fromResolved.error };
      }
      if (fromResolved.provenance.kind !== 'sourcesJar') {
        return { ok: true, hit: false };
      }
      return {
        ok: true,
        hit: true,
        sourceText: fromResolved.source,
        provenance: fromResolved.provenance,
      };
    }
  }

  return { ok: true, hit: false };
}
