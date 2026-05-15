import { existsSync } from 'node:fs';
import { join } from 'node:path';

const JAVA_MAIN = 'build/classes/java/main';
const JAVA_TEST = 'build/classes/java/test';
const KOTLIN_MAIN = 'build/classes/kotlin/main';
const KOTLIN_TEST = 'build/classes/kotlin/test';

/**
 * Classpath roots beneath a Gradle submodule that may contain compiled `.class` files.
 * Order prefers main over test sources; Kotlin outputs are secondary to Java JVM convention.
 */
export function interprojectBytecodeRootSuffixes(includeTest: boolean): string[] {
  const main = [JAVA_MAIN, KOTLIN_MAIN];
  const test = [JAVA_TEST, KOTLIN_TEST];
  return includeTest ? [...main, ...test] : main;
}

/**
 * Returns the first build output dir under `moduleRoot` that contains the given `.class` path.
 */
export function resolveInterprojectClasspathRootForBinary(
  moduleRoot: string,
  classRelPath: string,
  includeTest: boolean,
): string | null {
  for (const rel of interprojectBytecodeRootSuffixes(includeTest)) {
    const root = join(moduleRoot, rel);
    if (existsSync(join(root, classRelPath))) {
      return root;
    }
  }
  return null;
}

export function candidateInterprojectJavaSourcePaths(
  moduleRoot: string,
  sourceRelPath: string,
  includeTest: boolean,
): string[] {
  const paths = [join(moduleRoot, 'src/main/java', sourceRelPath)];
  if (includeTest) {
    paths.push(join(moduleRoot, 'src/test/java', sourceRelPath));
  }
  return paths;
}
