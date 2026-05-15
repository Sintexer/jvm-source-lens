import { extractClassMemberSection, parseJavapVerboseMethods } from './class-structure/javap-parse.js';
import type { JavapMethodOverload } from './class-structure/types.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import { spawnJavapVerbose } from './class-structure/spawn-javap.js';

export type JavapMethodOverloadsResult =
  | { ok: true; overloads: JavapMethodOverload[] }
  | { ok: false; error: Extract<ClassSourceError, { code: 'SIGNATURE_EXTRACT_FAILED' }> };

/**
 * Runs `javap -private -verbose` on `classpath` and extracts overloads for `methodName` on `className`.
 */
export async function loadMethodOverloadsViaJavap(args: {
  classpath: string;
  className: string;
  methodName: string;
}): Promise<JavapMethodOverloadsResult> {
  const { classpath, className, methodName } = args;

  const javap = await spawnJavapVerbose({
    classpath,
    className,
  });

  if (!javap.ok) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: javap.message,
        className,
        methodName,
        jarPath: classpath,
        stderr: javap.stderr,
      },
    };
  }

  if (extractClassMemberSection(javap.stdout) === null) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: 'Could not locate class member section in javap output',
        className,
        methodName,
        jarPath: classpath,
      },
    };
  }

  const overloads = parseJavapVerboseMethods(javap.stdout, methodName, className);
  return { ok: true, overloads };
}
