import type { ArtifactCoordinates, ClassSourceLookupOptions } from './class-source-types.js';
import { isExternalJarArtifact } from './class-source-types.js';
import { fqnToZipRelPaths } from './fqn-paths.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import type { ResolvedArtifact } from '../resolvers/resolution-output.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import type { ClassSourceError } from './class-source-types.js';
import { zipEntryExists } from './zip-entry.js';

export type ExternalJarOwningClassHit = {
  artifact: ResolvedArtifact;
  jarPath: string;
  coordinates: ArtifactCoordinates;
  classRelPath: string;
  searchedArtifactCount: number;
};

export type FindExternalJarResult =
  | { ok: true; hit: ExternalJarOwningClassHit }
  | { ok: false; error: ClassSourceError };

/**
 * First external JAR on the resolved classpath that contains the given .class entry.
 * Iteration order matches {@link extractExternalClassSource}.
 */
export function findExternalJarOwningClass(
  output: ResolutionOutput,
  opts: Pick<ClassSourceLookupOptions, 'className' | 'modulePath' | 'configuration' | 'includeTest'>,
): FindExternalJarResult {
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

  return findExternalJarAmongArtifacts(
    picked.configuration.artifacts.filter(isExternalJarArtifact),
    paths.classRelPath,
    opts.className,
  );
}

export function findExternalJarAmongArtifacts(
  artifacts: ResolvedArtifact[],
  classRelPath: string,
  className: string,
): FindExternalJarResult {
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
        artifact: a,
        jarPath: a.jarPath,
        coordinates,
        classRelPath,
        searchedArtifactCount,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'CLASS_NOT_FOUND',
      message: `Class not found in external JARs on this classpath (${searchedArtifactCount} artifact(s) scanned). Interproject sources are not searched in this version.`,
      className,
      searchedArtifactCount,
    },
  };
}
