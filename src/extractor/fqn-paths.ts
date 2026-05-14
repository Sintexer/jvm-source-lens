import type { ClassSourceError } from './class-source-types.js';

const segment = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function isValidFqn(fqn: string): boolean {
  if (fqn.length === 0 || fqn.startsWith('.') || fqn.endsWith('.')) {
    return false;
  }
  const parts = fqn.split('.');
  for (const p of parts) {
    if (p.length === 0 || !segment.test(p)) {
      return false;
    }
  }
  return true;
}

export type FqnPaths =
  | { ok: true; sourceRelPath: string; classRelPath: string }
  | { ok: false; error: ClassSourceError };

/**
 * Maps a fully-qualified class name to ZIP entry paths for `.java` and `.class`.
 * Inner classes use `$` in the simple name segment (e.g. `com.foo.Bar$Inner`).
 */
export function fqnToZipRelPaths(fqn: string): FqnPaths {
  if (!isValidFqn(fqn)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_FQN',
        message: `Not a valid fully-qualified class name: ${JSON.stringify(fqn)}`,
      },
    };
  }
  const lastDot = fqn.lastIndexOf('.');
  const pkg = lastDot === -1 ? '' : fqn.slice(0, lastDot);
  const simple = lastDot === -1 ? fqn : fqn.slice(lastDot + 1);
  const dir = pkg.length === 0 ? '' : `${pkg.replaceAll('.', '/')}/`;
  return {
    ok: true,
    sourceRelPath: `${dir}${simple}.java`,
    classRelPath: `${dir}${simple}.class`,
  };
}
