import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type {
  ArtifactCoordinates,
  ClassSourceLookupResult,
} from './class-source-types.js';
import { candidateInterprojectJavaSourcePaths } from './interproject-paths.js';
import type { ResolvedArtifact } from '../resolvers/resolution-output.js';

/**
 * If `artifact` is an inter-project edge, tries `src/main/java` (and optionally
 * `src/test/java`) for the canonical `.java` path derived from `sourceRelPath`.
 */
export async function readInterprojectJavaIfPresent(
  artifact: ResolvedArtifact,
  sourceRelPath: string,
  className: string,
  includeTest: boolean,
): Promise<ClassSourceLookupResult | null> {
  if (artifact.origin !== 'interproject' || !artifact.interproject) {
    return null;
  }

  const moduleRoot = artifact.interproject.modulePath;
  const coords: ArtifactCoordinates = {
    group: artifact.group,
    name: artifact.name,
    version: artifact.version,
  };

  const paths = candidateInterprojectJavaSourcePaths(moduleRoot, sourceRelPath, includeTest);

  for (const absoluteSourcePath of paths) {
    if (!existsSync(absoluteSourcePath)) {
      continue;
    }
    const source = await readFile(absoluteSourcePath, 'utf8');

    return {
      ok: true,
      source,
      sourceAvailable: true,
      className,
      provenance: {
        kind: 'interproject',
        coordinates: coords,
        moduleName: artifact.interproject.moduleName,
        moduleRoot,
        sourceRelativePath: sourceRelPath,
        absoluteSourcePath,
      },
    };
  }

  return null;
}
