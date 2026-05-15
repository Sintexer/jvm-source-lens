import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves `fqn` to an on-disk `.java` under `moduleRoot/src/main/java` or, when `includeTest`, `src/test/java`.
 */
export function resolveInterprojectJavaAbsolutePath(
  moduleRoot: string,
  fqn: string,
  includeTest: boolean,
): string | null {
  const rel = `${fqn.replaceAll('.', '/')}.java`;
  const main = path.join(moduleRoot, 'src', 'main', 'java', rel);
  try {
    if (fs.existsSync(main) && fs.statSync(main).isFile()) {
      return main;
    }
  } catch {
    return null;
  }
  if (!includeTest) {
    return null;
  }
  const test = path.join(moduleRoot, 'src', 'test', 'java', rel);
  try {
    if (fs.existsSync(test) && fs.statSync(test).isFile()) {
      return test;
    }
  } catch {
    return null;
  }
  return null;
}
