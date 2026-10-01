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
 * Resolves user-supplied module text against resolved modules: exact → normalized →
 * case-insensitive → unique directory-name match → unique path suffix match.
 * The root project is named `root` in resolution output and also matches `:` / `` / `.`.
 */
export function matchModule(raw: string, modules: ResolvedModule[]): ModuleMatch {
  const exact = modules.find((m) => m.name === raw);
  if (exact !== undefined) {
    return { kind: 'match', module: exact };
  }

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
  return byPath ?? { kind: 'none' };
}
