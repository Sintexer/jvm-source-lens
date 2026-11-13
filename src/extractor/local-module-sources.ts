import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  sourceLanguageFromPath,
  type ArtifactCoordinates,
  type ClassSourceLookupResult,
} from './class-source-types.js';
import { candidateInterprojectSourcePaths } from './interproject-paths.js';
import { resolveInterprojectClasspathRootForBinary } from './interproject-paths.js';
import type { ResolvedModule } from '../resolvers/resolution-output.js';

function localModuleCoordinates(module: ResolvedModule): ArtifactCoordinates {
  return {
    group: 'project',
    name: module.name,
    version: null,
  };
}

/**
 * Reads a source file from the selected module's own tree
 * (`src/{main,test}/{java,kotlin,scala,groovy}`). A `.java` request also opens the same
 * path as `.kt`, `.scala` or `.groovy`. Sibling edges do not include the querying module.
 */
export async function tryReadLocalModuleJavaSource(
  module: ResolvedModule,
  sourceRelPath: string,
  className: string,
  includeTest: boolean,
): Promise<ClassSourceLookupResult | null> {
  for (const candidate of candidateInterprojectSourcePaths(module.path, sourceRelPath, includeTest)) {
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
        coordinates: localModuleCoordinates(module),
        moduleName: module.name,
        moduleRoot: module.path,
        sourceRelativePath: candidate.sourceRelPath,
        absoluteSourcePath: candidate.absolutePath,
      },
    };
  }
  return null;
}

/**
 * Classpath root under the selected module's `build/classes/**` when the `.class` is compiled locally.
 */
export function findLocalModuleClasspathRoot(
  module: ResolvedModule,
  classRelPath: string,
  includeTest: boolean,
): string | null {
  return resolveInterprojectClasspathRootForBinary(module.path, classRelPath, includeTest);
}
