import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  sourceLanguageFromPath,
  type ArtifactCoordinates,
  type ClassSourceLookupResult,
} from './class-source-types.js';
import { candidateInterprojectSourcePaths } from './interproject-paths.js';
import type { ResolvedArtifact } from '../resolvers/resolution-output.js';

/**
 * If `artifact` is an inter-project edge, tries `src/{main,test}/{java,kotlin,scala,groovy}`
 * for `sourceRelPath`. A `.java` request also opens the same path as `.kt`, `.scala` or `.groovy`.
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

  for (const candidate of candidateInterprojectSourcePaths(moduleRoot, sourceRelPath, includeTest)) {
    if (!existsSync(candidate.absolutePath)) {
      continue;
    }
    const source = await readFile(candidate.absolutePath, 'utf8');

    return {
      ok: true,
      source,
      sourceAvailable: true,
      sourceLanguage: sourceLanguageFromPath(candidate.sourceRelPath),
      className,
      provenance: {
        kind: 'interproject',
        coordinates: coords,
        moduleName: artifact.interproject.moduleName,
        moduleRoot,
        sourceRelativePath: candidate.sourceRelPath,
        absoluteSourcePath: candidate.absolutePath,
      },
    };
  }

  return null;
}
