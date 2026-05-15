import type { ArtifactCoordinates, ClassSourceLookupOptions } from './class-source-types.js';
import { isClasspathBinaryJarArtifact } from './class-source-types.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { resolveInterprojectClasspathRootForBinary } from './interproject-paths.js';
import type { ResolvedArtifact } from '../resolvers/resolution-output.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import type { ClassSourceError } from './class-source-types.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { zipEntryExists } from './zip-entry.js';

export type ClasspathOwningClassHit =
  | {
      kind: 'externalJar';
      artifact: ResolvedArtifact;
      coordinates: ArtifactCoordinates;
      classRelPath: string;
      /** Classpath element for javap (`-classpath`): dependency JAR. */
      classpath: string;
      searchedArtifactCount: number;
    }
  | {
      kind: 'interprojectBytecode';
      artifact: ResolvedArtifact;
      coordinates: ArtifactCoordinates;
      classRelPath: string;
      /** Classpath root dir for javap (`-classpath`): Gradle output (e.g. `build/classes/java/main`). */
      classpath: string;
      moduleName: string;
      moduleRoot: string;
      searchedArtifactCount: number;
    };

/** @deprecated Use {@link ClasspathOwningClassHit} (`kind: 'externalJar'`). */
export type ExternalJarOwningClassHit = Extract<ClasspathOwningClassHit, { kind: 'externalJar' }>;

export type FindClasspathOwningClassResult =
  | { ok: true; hit: ClasspathOwningClassHit }
  | { ok: false; error: ClassSourceError };

/** @deprecated Use {@link FindClasspathOwningClassResult}. */
export type FindExternalJarResult = FindClasspathOwningClassResult;

function countClasspathSearchArtifacts(list: ResolvedArtifact[]): number {
  return list.filter(
    (a) =>
      isClasspathBinaryJarArtifact(a) || (a.origin === 'interproject' && Boolean(a.interproject)),
  ).length;
}

/**
 * Classpath order: first inter-project submodule output dir or external JAR that contains the `.class`,
 * mirroring Gradle resolution order alongside {@link extractExternalClassSource}.
 */
export function findClasspathOwningClass(
  output: ResolutionOutput,
  opts: Pick<ClassSourceLookupOptions, 'className' | 'modulePath' | 'configuration' | 'includeTest'>,
): FindClasspathOwningClassResult {
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

  const artifacts = picked.configuration.artifacts;
  const searchedArtifactCount = countClasspathSearchArtifacts(artifacts);

  for (const a of artifacts) {
    const coordinates: ArtifactCoordinates = {
      group: a.group,
      name: a.name,
      version: a.version,
    };

    if (a.origin === 'interproject' && a.interproject) {
      const root = resolveInterprojectClasspathRootForBinary(
        a.interproject.modulePath,
        paths.classRelPath,
        Boolean(opts.includeTest),
      );
      if (root !== null) {
        return {
          ok: true,
          hit: {
            kind: 'interprojectBytecode',
            artifact: a,
            coordinates,
            classRelPath: paths.classRelPath,
            classpath: root,
            moduleName: a.interproject.moduleName,
            moduleRoot: a.interproject.modulePath,
            searchedArtifactCount,
          },
        };
      }
      continue;
    }

    if (!isClasspathBinaryJarArtifact(a)) {
      continue;
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

    return {
      ok: true,
      hit: {
        kind: 'externalJar',
        artifact: a,
        coordinates,
        classRelPath: paths.classRelPath,
        classpath: a.jarPath,
        searchedArtifactCount,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'CLASS_NOT_FOUND',
      message: `Class not found on this classpath (${searchedArtifactCount} classpath edge(s) checked — inter-project outputs, external JARs, and local file JARs). Verify the fully-qualified name, modulePath, configuration, or includeTest scope.`,
      className: opts.className,
      searchedArtifactCount,
    },
  };
}

/** @deprecated Use {@link findClasspathOwningClass}. */
export function findExternalJarOwningClass(
  output: ResolutionOutput,
  opts: Pick<ClassSourceLookupOptions, 'className' | 'modulePath' | 'configuration' | 'includeTest'>,
): FindClasspathOwningClassResult {
  return findClasspathOwningClass(output, opts);
}

export function findExternalJarAmongArtifacts(
  artifacts: ResolvedArtifact[],
  classRelPath: string,
  className: string,
): FindClasspathOwningClassResult {
  const searchedArtifactCount = artifacts.length;

  for (const a of artifacts) {
    if (a.jarPath === null || a.jarPath.length === 0) {
      continue;
    }

    const pres = zipEntryExists(a.jarPath, classRelPath);
    if (!pres.ok) {
      return { ok: false, error: pres.error };
    }
    if (!pres.exists) {
      continue;
    }

    const coordinates: ArtifactCoordinates = {
      group: a.group,
      name: a.name,
      version: a.version,
    };

    return {
      ok: true,
      hit: {
        kind: 'externalJar',
        artifact: a,
        coordinates,
        classRelPath,
        classpath: a.jarPath,
        searchedArtifactCount,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'CLASS_NOT_FOUND',
      message: `Class not found in external JARs on this classpath (${searchedArtifactCount} artifact(s) scanned).`,
      className,
      searchedArtifactCount,
    },
  };
}
