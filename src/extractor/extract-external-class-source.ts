import { decompileExternalClass } from '../decompiler/decompile-external-class.js';
import {
  sourceLanguageFromPath,
  type ArtifactCoordinates,
  type ClassSourceLookupOptions,
  type ClassSourceLookupResult,
} from './class-source-types.js';
import { isClasspathBinaryJarArtifact, isExternalJarArtifact } from './class-source-types.js';
import { findExternalJarAmongArtifacts } from './find-external-class-jar.js';
import { packageOfClassName, readJarClassSourceFile } from './class-file-source-file.js';
import { fqnToSourceCandidates, withSourceFileCandidate } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { tryReadLocalModuleJavaSource } from './local-module-sources.js';
import { presentNestedSource, anonymousOrLocalClassError } from './nested-class-source.js';
import { moduleTreeSourceRelPaths } from './interproject-paths.js';
import { readInterprojectJavaIfPresent } from './read-interproject-java-source.js';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { findSourceEntriesByFileName, readZipEntryUtf8 } from './zip-entry.js';

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
      sourceLanguage: sourceLanguageFromPath(sourceRelPath),
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

function openedSourceRel(hit: ClassSourceLookupResult, requested: string): string {
  if (hit.ok && hit.provenance.kind === 'interproject') {
    return hit.provenance.sourceRelativePath;
  }
  return requested;
}

function acceptSourceHit(
  hit: ClassSourceLookupResult,
  className: string,
  sourceRelPath: string,
  exactSourceRelPath: string,
): ClassSourceLookupResult | null {
  if (!hit.ok) {
    return hit;
  }
  return presentNestedSource(hit, className, openedSourceRel(hit, sourceRelPath), exactSourceRelPath);
}

async function readFirstCandidate(
  sourceRelPaths: readonly string[],
  read: (sourceRelPath: string) => Promise<ClassSourceLookupResult | null> | ClassSourceLookupResult | null,
  className: string,
  exact: string = sourceRelPaths[0]!,
): Promise<ClassSourceLookupResult | null> {
  for (const rel of sourceRelPaths) {
    const hit = await read(rel);
    if (hit === null) {
      continue;
    }
    const accepted = acceptSourceHit(hit, className, rel, exact);
    if (accepted !== null) {
      return accepted;
    }
  }
  return null;
}

function readCachedSources(
  artifact: ResolvedArtifact,
  sourceRelPaths: readonly string[],
  className: string,
): ClassSourceLookupResult | null {
  const sourcesJarPath = artifact.sourcesJarPath ?? null;
  if (sourcesJarPath === null || sourcesJarPath.length === 0) {
    return null;
  }
  return readSourcesJarCandidates(sourcesJarPath, sourceRelPaths, sourceRelPaths[0]!, className, {
    group: artifact.group,
    name: artifact.name,
    version: artifact.version,
  });
}

function readSourcesJarCandidates(
  sourcesJarPath: string,
  sourceRelPaths: readonly string[],
  exact: string,
  className: string,
  coordinates: ArtifactCoordinates,
): ClassSourceLookupResult | null {
  for (const rel of sourceRelPaths) {
    const hit = tryReadSourceFromJar(sourcesJarPath, rel, className, coordinates);
    if (hit === null) {
      continue;
    }
    const accepted = acceptSourceHit(hit, className, rel, exact);
    if (accepted !== null) {
      return accepted;
    }
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

  const anonymous = anonymousOrLocalClassError(opts.className);
  if (anonymous) {
    return { ok: false, error: anonymous };
  }

  const paths = fqnToSourceCandidates(opts.className);
  if (!paths.ok) {
    return { ok: false, error: paths.error };
  }
  const includeTest = Boolean(opts.includeTest);

  const exact = paths.sourceRelPaths[0]!;
  const local = await readFirstCandidate(
    moduleTreeSourceRelPaths(picked.module.path, opts.className, paths.classRelPath, paths.sourceRelPaths, includeTest),
    (rel) => tryReadLocalModuleJavaSource(picked.module, rel, opts.className, includeTest),
    opts.className,
    exact,
  );
  if (local !== null) {
    return local;
  }

  for (const edge of picked.configuration.artifacts) {
    const rels =
      edge.origin === 'interproject' && edge.interproject
        ? moduleTreeSourceRelPaths(
            edge.interproject.modulePath,
            opts.className,
            paths.classRelPath,
            paths.sourceRelPaths,
            includeTest,
          )
        : paths.sourceRelPaths;
    const ip = await readFirstCandidate(
      rels,
      (rel) => readInterprojectJavaIfPresent(edge, rel, opts.className, includeTest),
      opts.className,
      exact,
    );
    if (ip !== null) {
      return ip;
    }
  }

  for (const a of picked.configuration.artifacts) {
    if (a.origin === 'interproject') {
      continue;
    }
    const fromCached = readCachedSources(a, paths.sourceRelPaths, opts.className);
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
    const sourceFile = readJarClassSourceFile(hit.classpath, paths.classRelPath);
    const exact = paths.sourceRelPaths[0]!;
    let fromResolved = readSourcesJarCandidates(
      sourcesJarPath,
      withSourceFileCandidate(opts.className, paths.sourceRelPaths, sourceFile),
      exact,
      opts.className,
      coordinates,
    );
    if (fromResolved === null && sourceFile !== null) {
      const byName = findSourceEntriesByFileName(sourcesJarPath, sourceFile, packageOfClassName(opts.className));
      if (!byName.ok) {
        return { ok: false, error: byName.error };
      }
      fromResolved = readSourcesJarCandidates(sourcesJarPath, byName.entryRelPaths, exact, opts.className, coordinates);
    }
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
