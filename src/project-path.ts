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

const GRADLE_ROOT_MARKERS = ['settings.gradle', 'settings.gradle.kts', 'gradlew'] as const;

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function hasGradleRootMarker(dir: string): boolean {
  return GRADLE_ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

/** Nearest ancestor (or `start` itself) holding `gradlew` / `settings.gradle(.kts)`, or `null`. */
export function findGradleRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (hasGradleRootMarker(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export type ProjectRootSource = 'argument' | 'workspace-root' | 'env' | 'cwd';

export type ResolvedProjectRoot =
  | { ok: true; path: string; source: ProjectRootSource; note?: string }
  | { ok: false; message: string };

export type ResolveProjectRootOptions = {
  /** Workspace directories announced by the MCP client (`roots/list`), in client order. */
  workspaceRoots?: string[];
};

function envProjectRoot(): string | undefined {
  const raw = process.env.JVMSRC_PROJECT_ROOT?.trim();
  return raw ? raw : undefined;
}

/** Walks up to the Gradle root; keeps `start` when none is found or the ancestor is outside the allowlist. */
function liftToGradleRoot(start: string): { path: string; found: boolean } {
  const found = findGradleRoot(start);
  if (found !== null && assertProjectRootAllowed(found).ok) {
    return { path: found, found: true };
  }
  return { path: start, found: found !== null && found === start };
}

function discoverFromWorkspace(
  opts: ResolveProjectRootOptions,
): { path: string; source: ProjectRootSource } | null {
  const candidates: { dir: string; source: ProjectRootSource }[] = [
    ...(opts.workspaceRoots ?? []).map((dir) => ({ dir, source: 'workspace-root' as const })),
    ...(envProjectRoot() ? [{ dir: path.resolve(envProjectRoot()!), source: 'env' as const }] : []),
    { dir: process.cwd(), source: 'cwd' },
  ];
  for (const c of candidates) {
    if (!isDirectory(c.dir)) {
      continue;
    }
    const lifted = liftToGradleRoot(c.dir);
    if (lifted.found) {
      return { path: lifted.path, source: c.source };
    }
  }
  return null;
}

function triedLocations(opts: ResolveProjectRootOptions): string {
  const dirs = [...(opts.workspaceRoots ?? []), envProjectRoot(), process.cwd()].filter(
    (d): d is string => d !== undefined,
  );
  return dirs.join(', ');
}

/**
 * Resolves the Gradle project root for a tool call.
 *
 * With `input`: relative paths are tried against the workspace roots, `JVMSRC_PROJECT_ROOT` and `cwd`;
 * a subdirectory is lifted to the nearest `gradlew` / `settings.gradle(.kts)`.
 * Without `input`: first of workspace roots → `JVMSRC_PROJECT_ROOT` → `cwd` that sits inside a Gradle project.
 */
export function resolveProjectRoot(
  input?: string,
  opts: ResolveProjectRootOptions = {},
): ResolvedProjectRoot {
  const trimmed = input?.trim();
  if (!trimmed) {
    const found = discoverFromWorkspace(opts);
    if (found === null) {
      return {
        ok: false,
        message:
          `No Gradle project found in the workspace (looked in: ${triedLocations(opts)}). ` +
          'Retry with projectRoot set to the absolute path of the directory containing gradlew or settings.gradle(.kts).',
      };
    }
    const allowed = assertProjectRootAllowed(found.path);
    return allowed.ok ? { ok: true, path: allowed.path, source: found.source } : allowed;
  }

  const bases = [
    ...(opts.workspaceRoots ?? []),
    ...(envProjectRoot() ? [path.resolve(envProjectRoot()!)] : []),
    process.cwd(),
  ];
  const candidates = path.isAbsolute(trimmed)
    ? [path.resolve(trimmed)]
    : bases.map((b) => path.resolve(b, trimmed));
  const resolved = candidates.find(isDirectory);

  if (resolved === undefined) {
    const shown = candidates[0] ?? path.resolve(trimmed);
    const exists = fs.existsSync(shown);
    const hint = discoverFromWorkspace(opts);
    return {
      ok: false,
      message:
        (exists ? `Project path is not a directory: ${shown}.` : `Project path does not exist: ${shown}.`) +
        (hint !== null
          ? ` A Gradle project was found at ${hint.path}; retry with projectRoot=${JSON.stringify(hint.path)} or omit projectRoot.`
          : ' Pass the absolute path of the directory containing gradlew or settings.gradle(.kts).'),
    };
  }

  const allowed = assertProjectRootAllowed(resolved);
  if (!allowed.ok) {
    return allowed;
  }
  const lifted = liftToGradleRoot(resolved);
  if (lifted.path !== resolved) {
    return {
      ok: true,
      path: lifted.path,
      source: 'argument',
      note: `projectRoot ${resolved} is inside the Gradle project at ${lifted.path}; using that.`,
    };
  }
  return { ok: true, path: resolved, source: 'argument' };
}
