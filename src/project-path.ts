import fs from 'node:fs';
import path from 'node:path';
import type { DependencyResolver } from './resolvers/base.js';
import { allResolvers } from './resolvers/index.js';

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

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findMatchingBuildRoot(start: string): { root: string; resolver: DependencyResolver } | null {
  for (const resolver of allResolvers()) {
    const root = resolver.findBuildRoot(start);
    if (root !== null) {
      return { root, resolver };
    }
  }
  return null;
}

/** Nearest ancestor (or `start` itself) recognized by any registered resolver, or `null`. */
export function findBuildRoot(start: string): string | null {
  return findMatchingBuildRoot(start)?.root ?? null;
}

export type ResolvedProjectRoot =
  | { ok: true; path: string; note?: string }
  | { ok: false; message: string };

export type ResolveProjectRootOptions = {
  /** Workspace directories announced by the MCP client (`roots/list`), in client order. */
  workspaceRoots?: string[];
};

function envProjectRoot(): string | undefined {
  const raw = process.env.JVMSRC_PROJECT_ROOT?.trim();
  return raw ? raw : undefined;
}

/** Walks up to the build root; keeps `start` when none is found or the ancestor is outside the allowlist. */
function liftToBuildRoot(start: string): {
  path: string;
  found: boolean;
  resolver?: DependencyResolver;
} {
  const match = findMatchingBuildRoot(start);
  if (match !== null && assertProjectRootAllowed(match.root).ok) {
    return { path: match.root, found: true, resolver: match.resolver };
  }
  return {
    path: start,
    found: match !== null && match.root === start,
    resolver: match !== null && match.root === start ? match.resolver : undefined,
  };
}

function discoverFromWorkspace(
  opts: ResolveProjectRootOptions,
): { path: string; resolver: DependencyResolver } | null {
  const candidates = [
    ...(opts.workspaceRoots ?? []),
    ...(envProjectRoot() ? [path.resolve(envProjectRoot()!)] : []),
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (!isDirectory(dir)) {
      continue;
    }
    const lifted = liftToBuildRoot(dir);
    if (lifted.found && lifted.resolver) {
      return { path: lifted.path, resolver: lifted.resolver };
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

function supportedProjectsLabel(): string {
  return allResolvers()
    .map((r) => r.displayName)
    .join(' or ');
}

function supportedRootHintsLabel(): string {
  return allResolvers()
    .map((r) => r.rootHint)
    .join(', or ');
}

/**
 * Resolves the build project root for a tool call.
 *
 * With `input`: relative paths are tried against the workspace roots, `JVMSRC_PROJECT_ROOT` and `cwd`;
 * a subdirectory is lifted to the build root identified by the registered resolvers.
 * Without `input`: first of workspace roots → `JVMSRC_PROJECT_ROOT` → `cwd` that sits inside a supported build.
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
          `No ${supportedProjectsLabel()} project found in the workspace (looked in: ${triedLocations(opts)}). ` +
          `Retry with projectRoot set to the absolute path of the directory containing ${supportedRootHintsLabel()}.`,
      };
    }
    return assertProjectRootAllowed(found.path);
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
          ? ` A ${hint.resolver.displayName} project was found at ${hint.path}; retry with projectRoot=${JSON.stringify(hint.path)} or omit projectRoot.`
          : ` Pass the absolute path of the directory containing ${supportedRootHintsLabel()}.`),
    };
  }

  const allowed = assertProjectRootAllowed(resolved);
  if (!allowed.ok) {
    return allowed;
  }
  const lifted = liftToBuildRoot(resolved);
  if (lifted.path !== resolved && lifted.resolver) {
    return {
      ok: true,
      path: lifted.path,
      note: `projectRoot ${resolved} is inside the ${lifted.resolver.displayName} project at ${lifted.path}; using that.`,
    };
  }
  return { ok: true, path: resolved };
}
