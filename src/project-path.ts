import fs from 'node:fs';
import path from 'node:path';

export type ProjectRootResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

/** Comma-separated absolute roots from `JVMSRC_ALLOWED_ROOTS`, or `null` when unset. */
export function parseAllowedProjectRoots(): string[] | null {
  const raw = process.env.JVMSRC_ALLOWED_ROOTS?.trim();
  if (!raw) {
    return null;
  }
  const roots = raw
    .split(',')
    .map((s) => path.resolve(s.trim()))
    .filter((s) => s.length > 0);
  return roots.length > 0 ? roots : null;
}

function isUnderAllowedRoot(projectRoot: string, allowedRoot: string): boolean {
  const root = path.resolve(allowedRoot);
  if (projectRoot === root) {
    return true;
  }
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return projectRoot.startsWith(prefix);
}

export function assertProjectRootAllowed(resolved: string): ProjectRootResult {
  const allowed = parseAllowedProjectRoots();
  if (!allowed) {
    return { ok: true, path: resolved };
  }
  for (const root of allowed) {
    if (isUnderAllowedRoot(resolved, root)) {
      return { ok: true, path: resolved };
    }
  }
  return {
    ok: false,
    message:
      `Project path is not under any directory listed in JVMSRC_ALLOWED_ROOTS: ${resolved}`,
  };
}

export function resolveProjectRoot(input: string): ProjectRootResult {
  const resolved = path.resolve(input);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, message: `Project path does not exist: ${resolved}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, message: `Project path is not a directory: ${resolved}` };
  }
  return assertProjectRootAllowed(resolved);
}
