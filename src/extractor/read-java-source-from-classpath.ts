import type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './class-source-types.js';
import { isClasspathBinaryJarArtifact, isExternalJarArtifact } from './class-source-types.js';
import { findExternalJarAmongArtifacts } from './find-external-class-jar.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { tryReadLocalModuleJavaSource } from './local-module-sources.js';
import { readInterprojectJavaIfPresent } from './read-interproject-java-source.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { readZipEntryUtf8 } from './zip-entry.js';

function tryReadSourceFromJar(
  sourcesJarPath: string,
  sourceRelPath: string,
  className: string,
  coordinates: ArtifactCoordinates,
): { ok: true; source: string; provenance: SourcesJarProvenance } | { ok: false; error: ClassSourceError } | null {
  const r = readZipEntryUtf8(sourcesJarPath, sourceRelPath);
  if (r.ok) {
    return {
      ok: true,
      source: r.text,
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

export type TryReadJavaSourceFromClasspathResult =
  | { ok: true; hit: true; sourceText: string; provenance: SourcesJarProvenance | InterprojectProvenance }
  | { ok: true; hit: false }
  | { ok: false; error: ClassSourceError };

/**
 * Classpath-order `.java` read (inter-project edges first, then sources JARs on external jars),
 * mirroring {@link extractExternalClassSource} / {@link tryReadPrimaryJavaSourceFromArtifacts}.
 */
export async function tryReadJavaSourceFromClasspath(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): Promise<TryReadJavaSourceFromClasspathResult> {
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

  const local = await tryReadLocalModuleJavaSource(
    picked.module,
    paths.sourceRelPath,
    opts.className,
    Boolean(opts.includeTest),
  );
  if (local !== null) {
    if (!local.ok) {
      return { ok: false, error: local.error };
    }
    const ipp = local.provenance;
    if (ipp.kind === 'interproject') {
      return {
        ok: true,
        hit: true,
        sourceText: local.source,
        provenance: ipp,
      };
    }
  }

  for (const edge of picked.configuration.artifacts) {
    const ip = await readInterprojectJavaIfPresent(
      edge,
      paths.sourceRelPath,
      opts.className,
      Boolean(opts.includeTest),
    );
    if (ip !== null) {
      if (!ip.ok) {
        return { ok: false, error: ip.error };
      }
      const ipp = ip.provenance;
      if (ipp.kind === 'interproject') {
        return {
          ok: true,
          hit: true,
          sourceText: ip.source,
          provenance: ipp,
        };
      }
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
      if (!fromCached.ok) {
        return { ok: false, error: fromCached.error };
      }
      return {
        ok: true,
        hit: true,
        sourceText: fromCached.source,
        provenance: fromCached.provenance,
      };
    }
  }

  const artifacts = picked.configuration.artifacts.filter(isClasspathBinaryJarArtifact);

  const jarHit = findExternalJarAmongArtifacts(artifacts, paths.classRelPath, opts.className);
  if (!jarHit.ok) {
    return { ok: false, error: jarHit.error };
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
    const fromResolved = tryReadSourceFromJar(sourcesJarPath, paths.sourceRelPath, opts.className, coordinates);
    if (fromResolved !== null) {
      if (!fromResolved.ok) {
        return { ok: false, error: fromResolved.error };
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
