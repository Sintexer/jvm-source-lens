import path from 'node:path';
import type { ResolvedModule } from '../resolvers/resolution-output.js';

const ROOT_MODULE_NAME = 'root';

/**
 * Canonical Gradle path for loosely written module input: `app`, `/app`, `app/`, `:app:`,
 * `libs/core` → `:app`, `:app`, `:app`, `:app`, `:libs:core`. Empty / `:` / `.` → `:` (the root project).
 */
export function normalizeModulePath(raw: string): string {
  const s = raw
    .trim()
    .replace(/^\.[\\/]+/, '')
    .replace(/^[:/\\]+|[:/\\]+$/g, '')
    .replace(/[:/\\]+/g, ':');
  return s === '' || s === '.' ? ':' : `:${s}`;
}

/** `modulePath: "*"` / `"all"` is the explicit spelling of "no module restriction" (same as omitting it). */
export function isAllModules(raw: string | undefined): boolean {
  const t = raw?.trim().toLowerCase();
  return t === '*' || t === 'all';
}

/** Returns `opts` with an all-modules `modulePath` dropped, so downstream code sees it as omitted. */
export function withoutAllModules<T extends { modulePath?: string }>(opts: T): T {
  return isAllModules(opts.modulePath) ? { ...opts, modulePath: undefined } : opts;
}

export type ModuleMatch =
  | { kind: 'match'; module: ResolvedModule }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

function lastSegment(gradlePath: string): string {
  return gradlePath.slice(gradlePath.lastIndexOf(':') + 1);
}

function pickUnique(candidates: ResolvedModule[]): ModuleMatch | undefined {
  if (candidates.length === 1) {
    return { kind: 'match', module: candidates[0]! };
  }
  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates: candidates.map((m) => m.name) };
  }
  return undefined;
}

/**
 * Module that contains a filesystem path (a source file or directory the agent is working in):
 * the module whose directory is the longest prefix of `raw`. Relative paths resolve against
 * `projectRoot`. `null` when `raw` is not path-like or lies outside every module.
 */
function matchByFilesystemPath(raw: string, modules: ResolvedModule[], projectRoot?: string): ResolvedModule | null {
  if (!/[\\/]/.test(raw)) {
    return null;
  }
  const trimmed = raw.trim();
  const abs = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : projectRoot !== undefined
      ? path.resolve(projectRoot, trimmed)
      : null;
  if (abs === null) {
    return null;
  }
  let best: ResolvedModule | null = null;
  for (const m of modules) {
    const dir = path.resolve(m.path);
    const inside = abs === dir || abs.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
    if (inside && (best === null || dir.length > path.resolve(best.path).length)) {
      best = m;
    }
  }
  return best;
}

/**
 * Resolves user-supplied module text against resolved modules: exact → (file/directory inside a
 * submodule) → normalized → case-insensitive → unique directory-name match → unique path suffix match.
 * A path inside the project but outside every submodule maps to the root project.
 * The root project is named `root` in resolution output and also matches `:` / `` / `.`.
 */
export function matchModule(raw: string, modules: ResolvedModule[], projectRoot?: string): ModuleMatch {
  const exact = modules.find((m) => m.name === raw);
  if (exact !== undefined) {
    return { kind: 'match', module: exact };
  }

  const byFile = matchByFilesystemPath(raw, modules, projectRoot);
  if (byFile !== null && byFile.name !== ROOT_MODULE_NAME) {
    return { kind: 'match', module: byFile };
  }
  const fileInRoot = byFile; // set only when the only containing module is root; used as a last resort

  const normalized = normalizeModulePath(raw);
  if (normalized === ':' || normalized.toLowerCase() === `:${ROOT_MODULE_NAME}`) {
    const root = modules.find((m) => m.name === ROOT_MODULE_NAME);
    if (root !== undefined) {
      return { kind: 'match', module: root };
    }
  }

  const gradlePath = (m: ResolvedModule): string => (m.name === ROOT_MODULE_NAME ? ':' : m.name);
  const lower = normalized.toLowerCase();

  const byNormalized = pickUnique(modules.filter((m) => gradlePath(m).toLowerCase() === lower));
  if (byNormalized !== undefined) {
    return byNormalized;
  }

  const wantedSegment = lastSegment(lower);
  const nonRoot = modules.filter((m) => m.name !== ROOT_MODULE_NAME);

  const bySuffix = pickUnique(nonRoot.filter((m) => m.name.toLowerCase().endsWith(lower)));
  if (bySuffix !== undefined) {
    return bySuffix;
  }

  const byDirName = pickUnique(nonRoot.filter((m) => lastSegment(m.name.toLowerCase()) === wantedSegment));
  if (byDirName !== undefined) {
    return byDirName;
  }

  const pathSuffix = lower.slice(1).replace(/:/g, '/');
  const byPath = pickUnique(
    nonRoot.filter((m) => m.path.replace(/\\/g, '/').toLowerCase().endsWith(`/${pathSuffix}`)),
  );
  if (byPath !== undefined) {
    return byPath;
  }
  return fileInRoot !== null ? { kind: 'match', module: fileInRoot } : { kind: 'none' };
}
