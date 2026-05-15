import type {
  ClassSourceError,
  ClassSourceLookupOptions,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './class-source-types.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { tryReadJavaSourceFromClasspath } from './read-java-source-from-classpath.js';

export type TryReadPrimaryJavaSourceResult =
  | { ok: true; hit: true; sourceText: string; provenance: SourcesJarProvenance | InterprojectProvenance }
  | { ok: true; hit: false }
  | { ok: false; error: ClassSourceError };

/**
 * Reads `.java` from a sources JAR if available (cached path or `resolveSourcesJar`),
 * without falling back to bytecode decompilation.
 */
export async function tryReadPrimaryJavaSourceFromArtifacts(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): Promise<TryReadPrimaryJavaSourceResult> {
  return tryReadJavaSourceFromClasspath(output, opts);
}
