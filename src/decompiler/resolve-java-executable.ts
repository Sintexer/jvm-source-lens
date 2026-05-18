import { resolveJavaBinExecutable } from './resolve-java-bin.js';

export type JavaExecutableResult =
  | { ok: true; javaPath: string }
  | { ok: false; message: string };

/**
 * Resolves the Java executable for CFR. Prefers `$JAVA_HOME/bin/java(.exe)` when present.
 */
export function resolveJavaExecutable(): JavaExecutableResult {
  const r = resolveJavaBinExecutable('java');
  return { ok: true, javaPath: r.path };
}
