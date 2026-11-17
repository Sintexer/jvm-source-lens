import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceFileAttribute } from './class-file-source-file.js';
import { withSourceFileCandidate } from './fqn-paths.js';

const JAVA_MAIN = 'build/classes/java/main';
const JAVA_TEST = 'build/classes/java/test';
const KOTLIN_MAIN = 'build/classes/kotlin/main';
const KOTLIN_TEST = 'build/classes/kotlin/test';
const MAVEN_MAIN = 'target/classes';
const MAVEN_TEST = 'target/test-classes';

/**
 * Classpath roots beneath a submodule that may contain compiled `.class` files
 * (Gradle `build/classes/...` and Maven `target/{classes,test-classes}`).
 */
export function interprojectBytecodeRootSuffixes(includeTest: boolean): string[] {
  const main = [JAVA_MAIN, KOTLIN_MAIN, MAVEN_MAIN];
  const test = [JAVA_TEST, KOTLIN_TEST, MAVEN_TEST];
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

const SOURCE_LANG_BY_EXT: Record<string, string> = {
  '.java': 'java',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.groovy': 'groovy',
};

export type InterprojectSourceCandidate = {
  /** Path inside the language root, for provenance (`com/acme/Foo.kt`). */
  sourceRelPath: string;
  absolutePath: string;
};

/**
 * On-disk candidates for one requested relative path. A `.java` request also tries
 * `.kt`, `.scala` and `.groovy` in their source roots. Main comes before test.
 */
export function candidateInterprojectSourcePaths(
  moduleRoot: string,
  sourceRelPath: string,
  includeTest: boolean,
): InterprojectSourceCandidate[] {
  const dot = sourceRelPath.lastIndexOf('.');
  const ext = dot < 0 ? '' : sourceRelPath.slice(dot);
  const stem = dot < 0 ? sourceRelPath : sourceRelPath.slice(0, dot);
  const rels = ext === '.java' ? [sourceRelPath, `${stem}.kt`, `${stem}.scala`, `${stem}.groovy`] : [sourceRelPath];
  const scopes = includeTest ? ['main', 'test'] : ['main'];
  const out: InterprojectSourceCandidate[] = [];
  for (const scope of scopes) {
    for (const rel of rels) {
      const relExt = rel.slice(rel.lastIndexOf('.'));
      const lang = SOURCE_LANG_BY_EXT[relExt];
      if (lang === undefined) {
        continue;
      }
      out.push({
        sourceRelPath: rel,
        absolutePath: join(moduleRoot, 'src', scope, lang, rel),
      });
    }
  }
  return out;
}

export function candidateInterprojectJavaSourcePaths(
  moduleRoot: string,
  sourceRelPath: string,
  includeTest: boolean,
): string[] {
  return candidateInterprojectSourcePaths(moduleRoot, sourceRelPath, includeTest).map((c) => c.absolutePath);
}

/**
 * `SourceFile` of the compiled `.class` under `build/classes/{java,kotlin}/{main,test}`,
 * or null when the class is not compiled or the attribute is absent.
 */
export function readCompiledSourceFileName(
  moduleRoot: string,
  classRelPath: string,
  includeTest: boolean,
): string | null {
  const classpath = resolveInterprojectClasspathRootForBinary(moduleRoot, classRelPath, includeTest);
  if (classpath === null) {
    return null;
  }
  try {
    return readSourceFileAttribute(readFileSync(join(classpath, classRelPath)));
  } catch {
    return null;
  }
}

/**
 * Name-based source paths, with the compiled class's `SourceFile` first.
 * `allowSourceFile` drops an attribute the caller cannot parse (for example a `.kt` file for the Java parser).
 */
export function moduleTreeSourceRelPaths(
  moduleRoot: string,
  className: string,
  classRelPath: string,
  nameRelPaths: readonly string[],
  includeTest: boolean,
  allowSourceFile: (name: string) => boolean = () => true,
): string[] {
  let sourceFile = readCompiledSourceFileName(moduleRoot, classRelPath, includeTest);
  if (sourceFile !== null && !allowSourceFile(sourceFile)) {
    sourceFile = null;
  }
  return withSourceFileCandidate(className, nameRelPaths, sourceFile);
}
