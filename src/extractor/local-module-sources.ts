import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type {
  ArtifactCoordinates,
  ClassSourceLookupResult,
} from './class-source-types.js';
import { candidateInterprojectJavaSourcePaths } from './interproject-paths.js';
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
 * Reads `.java` from the selected module's own tree (`src/main/java`, and `src/test/java` when
 * `includeTest`). Sibling inter-project edges do not include the querying module itself.
 */
export async function tryReadLocalModuleJavaSource(
  module: ResolvedModule,
  sourceRelPath: string,
  className: string,
  includeTest: boolean,
): Promise<ClassSourceLookupResult | null> {
  const paths = candidateInterprojectJavaSourcePaths(module.path, sourceRelPath, includeTest);
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
        coordinates: localModuleCoordinates(module),
        moduleName: module.name,
        moduleRoot: module.path,
        sourceRelativePath: sourceRelPath,
        absoluteSourcePath,
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
