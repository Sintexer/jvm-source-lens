import {
  isClasspathBinaryJarArtifact,
  isExternalJarArtifact,
  type ArtifactCoordinates,
  type ClassSourceError,
  type ClassSourceLookupOptions,
  type InterprojectProvenance,
  type SourcesJarProvenance,
} from './class-source-types.js';
import { findExternalJarAmongArtifacts, type ClasspathOwningClassHit } from './find-external-class-jar.js';
import { packageOfClassName, readJarClassSourceFile } from './class-file-source-file.js';
import { fqnToSourceCandidates, withSourceFileCandidate } from './fqn-paths.js';
import { anonymousOrLocalClassError } from './nested-class-source.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { tryReadLocalModuleJavaSource } from './local-module-sources.js';
import { moduleTreeSourceRelPaths } from './interproject-paths.js';
import { readInterprojectJavaIfPresent } from './read-interproject-java-source.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { findSourceEntriesByFileName, readZipEntryUtf8 } from './zip-entry.js';

/** One source file read from a module tree or a sources JAR, before any accept rule. */
export type RawSourceHit = {
  source: string;
  provenance: SourcesJarProvenance | InterprojectProvenance;
};

export type SourceWalkStrategy<T> = {
  /** Whether a source file of this name may be opened (language filter). */
  allowsFile(sourceRelPath: string): boolean;
  /**
   * Decides what a raw hit gives. `openedRel` is the file really opened (a module tree may open
   * `.kt` for a requested `.java` path). `exactRel` is the file named after the class.
   * Null means "not this file, try the next candidate".
   */
  accept(hit: RawSourceHit, className: string, openedRel: string, exactRel: string): T | null;
};

export type SourceWalkResult<T> =
  | { kind: 'hit'; value: T }
  | { kind: 'error'; error: ClassSourceError }
  /** No source found. `jar` is the binary that owns the class (for the decompile tail). */
  | { kind: 'miss'; jar: ClasspathOwningClassHit };

type RawRead = RawSourceHit | { error: ClassSourceError } | null;

function readFromSourcesJar(sourcesJarPath: string, sourceRelPath: string, coordinates: ArtifactCoordinates): RawRead {
  const r = readZipEntryUtf8(sourcesJarPath, sourceRelPath);
  if (r.ok) {
    return { source: r.text, provenance: { kind: 'sourcesJar', coordinates, jarPath: sourcesJarPath } };
  }
  if (r.reason === 'error') {
    return { error: r.error };
  }
  return null;
}

function hasSourcesJar(path: string | null | undefined): path is string {
  return path !== null && path !== undefined && path.length > 0;
}

/**
 * Classpath-order source walk shared by `get` and the structure tools:
 * own module tree → inter-project edges → cached sources JARs → the binary JAR that owns the
 * class, with an on-demand sources JAR (`SourceFile` candidate, then by-file-name scan).
 */
export async function walkSourceCandidates<T>(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
  strategy: SourceWalkStrategy<T>,
): Promise<SourceWalkResult<T>> {
  const { allowsFile, accept } = strategy;
  const picked = pickResolvedConfiguration(output, {
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!picked.ok) {
    return { kind: 'error', error: picked.error };
  }
  const anonymous = anonymousOrLocalClassError(opts.className);
  if (anonymous) {
    return { kind: 'error', error: anonymous };
  }
  const paths = fqnToSourceCandidates(opts.className);
  if (!paths.ok) {
    return { kind: 'error', error: paths.error };
  }
  const { className } = opts;
  const includeTest = Boolean(opts.includeTest);
  const exact = paths.sourceRelPaths[0]!;

  async function firstCandidate(
    rels: readonly string[],
    read: (rel: string) => RawRead | Promise<RawRead>,
    exactRel: string = rels[0]!,
  ): Promise<SourceWalkResult<T> | null> {
    for (const rel of rels) {
      const hit = await read(rel);
      if (hit === null) {
        continue;
      }
      if ('error' in hit) {
        return { kind: 'error', error: hit.error };
      }
      const opened = hit.provenance.kind === 'interproject' ? hit.provenance.sourceRelativePath : rel;
      const value = accept(hit, className, opened, exactRel);
      if (value !== null) {
        return { kind: 'hit', value };
      }
    }
    return null;
  }

  /** Module-tree readers return a full lookup result; keep source + provenance, apply the language filter. */
  const fromModuleTree = (
    read: Awaited<ReturnType<typeof tryReadLocalModuleJavaSource>>,
  ): RawRead => {
    if (read === null) {
      return null;
    }
    if (!read.ok) {
      return { error: read.error };
    }
    if (read.provenance.kind !== 'interproject' || !allowsFile(read.provenance.sourceRelativePath)) {
      return null;
    }
    return { source: read.source, provenance: read.provenance };
  };

  const local = await firstCandidate(
    moduleTreeSourceRelPaths(
      picked.module.path,
      className,
      paths.classRelPath,
      paths.sourceRelPaths,
      includeTest,
      allowsFile,
    ),
    async (rel) => fromModuleTree(await tryReadLocalModuleJavaSource(picked.module, rel, className, includeTest)),
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
            className,
            paths.classRelPath,
            paths.sourceRelPaths,
            includeTest,
            allowsFile,
          )
        : paths.sourceRelPaths;
    const ip = await firstCandidate(
      rels,
      async (rel) => fromModuleTree(await readInterprojectJavaIfPresent(edge, rel, className, includeTest)),
      exact,
    );
    if (ip !== null) {
      return ip;
    }
  }

  for (const a of picked.configuration.artifacts) {
    if (a.origin === 'interproject' || !hasSourcesJar(a.sourcesJarPath)) {
      continue;
    }
    const sj = a.sourcesJarPath;
    const coordinates: ArtifactCoordinates = { group: a.group, name: a.name, version: a.version };
    const cached = await firstCandidate(paths.sourceRelPaths, (rel) => readFromSourcesJar(sj, rel, coordinates));
    if (cached !== null) {
      return cached;
    }
  }

  const artifacts = picked.configuration.artifacts.filter(isClasspathBinaryJarArtifact);
  const jarHit = findExternalJarAmongArtifacts(artifacts, paths.classRelPath, className);
  if (!jarHit.ok) {
    return { kind: 'error', error: jarHit.error };
  }
  const { hit } = jarHit;
  const a = hit.artifact;
  const coordinates = hit.coordinates;

  let sourcesJarPath = a.sourcesJarPath ?? null;
  if (!hasSourcesJar(sourcesJarPath) && opts.resolveSourcesJar && isExternalJarArtifact(a)) {
    sourcesJarPath = await opts.resolveSourcesJar(coordinates);
  }

  if (hasSourcesJar(sourcesJarPath)) {
    const sjPath = sourcesJarPath;
    const sourceFile = readJarClassSourceFile(hit.classpath, paths.classRelPath);
    const wantedSourceFile = sourceFile !== null && allowsFile(sourceFile) ? sourceFile : null;
    const readFromJar = (rel: string) => readFromSourcesJar(sjPath, rel, coordinates);
    let fromResolved = await firstCandidate(
      withSourceFileCandidate(className, paths.sourceRelPaths, wantedSourceFile),
      readFromJar,
      exact,
    );
    if (fromResolved === null && wantedSourceFile !== null) {
      const byName = findSourceEntriesByFileName(sjPath, wantedSourceFile, packageOfClassName(className));
      if (!byName.ok) {
        return { kind: 'error', error: byName.error };
      }
      fromResolved = await firstCandidate(byName.entryRelPaths, readFromJar, exact);
    }
    if (fromResolved !== null) {
      return fromResolved;
    }
  }

  return { kind: 'miss', jar: hit };
}
