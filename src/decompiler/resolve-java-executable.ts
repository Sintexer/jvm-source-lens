import fs from 'node:fs';
import path from 'node:path';

export type JavaExecutableResult =
  | { ok: true; javaPath: string }
  | { ok: false; message: string };

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the Java executable for CFR. Prefers `$JAVA_HOME/bin/java` when present.
 */
export function resolveJavaExecutable(): JavaExecutableResult {
  const javaHome = process.env.JAVA_HOME?.trim();
  if (javaHome) {
    const candidate = path.join(javaHome, 'bin', 'java');
    if (fs.existsSync(candidate) && isExecutable(candidate)) {
      return { ok: true, javaPath: candidate };
    }
  }
  return { ok: true, javaPath: 'java' };
}
