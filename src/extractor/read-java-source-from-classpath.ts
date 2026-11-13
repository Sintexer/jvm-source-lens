import type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './class-source-types.js';
import { isClasspathBinaryJarArtifact, isExternalJarArtifact } from './class-source-types.js';
import { locateTypeDeclaration } from '../class-structure/locate-type-declaration.js';
import { findExternalJarAmongArtifacts } from './find-external-class-jar.js';
import { readJarClassSourceFile } from './class-file-source-file.js';
import { fqnToSourceCandidates, withSourceFileCandidate } from './fqn-paths.js';
import { nestedTypeNames, anonymousOrLocalClassError } from './nested-class-source.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { tryReadLocalModuleJavaSource } from './local-module-sources.js';
import { moduleTreeSourceRelPaths } from './interproject-paths.js';
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

type SourceHit = { ok: true; source: string; provenance: SourcesJarProvenance | InterprojectProvenance };

function withNestedReadProvenance(
  provenance: SourcesJarProvenance | InterprojectProvenance,
  className: string,
  sourceRelPath: string,
  exactSourceRelPath: string,
): SourcesJarProvenance | InterprojectProvenance {
  const dollar = className.lastIndexOf('$');
  if (dollar >= 0) {
    return { ...provenance, nestedIn: className.slice(0, dollar), sourceRelativePath: sourceRelPath };
  }
  if (sourceRelPath !== exactSourceRelPath) {
    return { ...provenance, sourceRelativePath: sourceRelPath };
  }
  return provenance;
}

/**
 * Full compilation unit for structure and signatures. A file with another name (enclosing file,
 * or the `SourceFile` of a secondary top-level class) is kept only when it declares the type.
 * The text is not sliced; the parser walks the nested binary name.
 */
function acceptFullCompilationUnit(
  hit: SourceHit,
  className: string,
  sourceRelPath: string,
  exactSourceRelPath: string,
): TryReadJavaSourceFromClasspathResult | null {
  if (sourceRelPath !== exactSourceRelPath && !locateTypeDeclaration(hit.source, nestedTypeNames(className))) {
    return null;
  }
  return {
    ok: true,
    hit: true,
    sourceText: hit.source,
    provenance: withNestedReadProvenance(hit.provenance, className, sourceRelPath, exactSourceRelPath),
  };
}

async function readFirstCandidate(
  sourceRelPaths: readonly string[],
  className: string,
  read: (sourceRelPath: string) => Promise<SourceHit | { ok: false; error: ClassSourceError } | null>,
  exact: string = sourceRelPaths[0]!,
): Promise<TryReadJavaSourceFromClasspathResult | null> {
  for (const rel of sourceRelPaths) {
    const hit = await read(rel);
    if (hit === null) {
      continue;
    }
    if (!hit.ok) {
      return { ok: false, error: hit.error };
    }
    const accepted = acceptFullCompilationUnit(hit, className, rel, exact);
    if (accepted !== null) {
      return accepted;
    }
  }
  return null;
}

/**
 * Classpath-order `.java` read (inter-project edges first, then sources JARs on external jars),
 * mirroring {@link extractExternalClassSource}. Nested names try `Outer$Inner.java`, then each
 * enclosing compilation unit. The result is the full file, not the declaration slice.
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
    moduleTreeSourceRelPaths(picked.module.path, opts.className, paths.classRelPath, paths.sourceRelPaths, includeTest, true),
    opts.className,
    async (rel) => {
      const read = await tryReadLocalModuleJavaSource(picked.module, rel, opts.className, includeTest);
      if (read === null) {
        return null;
      }
      if (!read.ok) {
        return { ok: false, error: read.error };
      }
      if (read.provenance.kind !== 'interproject' || !read.provenance.sourceRelativePath.endsWith('.java')) {
        return null;
      }
      return { ok: true, source: read.source, provenance: read.provenance };
    },
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
            true,
          )
        : paths.sourceRelPaths;
    const ip = await readFirstCandidate(rels, opts.className, async (rel) => {
      const read = await readInterprojectJavaIfPresent(edge, rel, opts.className, includeTest);
      if (read === null) {
        return null;
      }
      if (!read.ok) {
        return { ok: false, error: read.error };
      }
      if (read.provenance.kind !== 'interproject' || !read.provenance.sourceRelativePath.endsWith('.java')) {
        return null;
      }
      return { ok: true, source: read.source, provenance: read.provenance };
    }, exact);
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
    const fromCached = await readFirstCandidate(paths.sourceRelPaths, opts.className, async (rel) =>
      tryReadSourceFromJar(sj, rel, opts.className, coordinates),
    );
    if (fromCached !== null) {
      return fromCached;
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
    const sourceFile = readJarClassSourceFile(hit.classpath, paths.classRelPath);
    const javaSourceFile = sourceFile !== null && sourceFile.endsWith('.java') ? sourceFile : null;
    const fromResolved = await readFirstCandidate(
      withSourceFileCandidate(opts.className, paths.sourceRelPaths, javaSourceFile),
      opts.className,
      async (rel) => tryReadSourceFromJar(sourcesJarPath!, rel, opts.className, coordinates),
      paths.sourceRelPaths[0]!,
    );
    if (fromResolved !== null) {
      return fromResolved;
    }
  }

  return { ok: true, hit: false };
}
