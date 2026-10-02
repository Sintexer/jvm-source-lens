import { ensureClassSearchIndex } from '../class-search/ensure-class-search-index.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import type { ClassSourceError } from './class-source-types.js';
import {
  inferModulePath,
  probeClassOwner,
  resolveModuleScopeOrError,
  type InferModulePathOptions,
  type ResolveModuleScopeResult,
} from './infer-module-path.js';
import { matchModule, withoutAllModules } from './match-module.js';
import { pickResolvedConfiguration } from './pick-classpath.js';

const SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_PICK_LIST = 10;

export type CanonicalClassName =
  | { ok: true; className: string; /** The input this name was derived from, when it changed meaningfully. */ resolvedFrom?: string }
  | { ok: false; error: ClassSourceError };

type Scope = Pick<InferModulePathOptions, 'modulePath' | 'configuration' | 'includeTest'>;

/** `com/foo/Bar.class`, `com.foo.Bar.java`, surrounding whitespace → `com.foo.Bar`. */
export function normalizeClassNameSyntax(raw: string): string {
  const s = raw.trim().replace(/[\\/]+/g, '.');
  const stripped = s.replace(/\.(class|java)$/, '');
  return stripped.length > 0 ? stripped : s;
}

function existsInScope(output: ResolutionOutput, className: string, scope: Scope): boolean {
  if (scope.modulePath !== undefined && scope.modulePath.length > 0) {
    const matched = matchModule(scope.modulePath, output.modules, output.projectRoot);
    return matched.kind === 'match' && probeClassOwner(output, matched.module.name, { className, ...scope }).owner !== null;
  }
  return inferModulePath(output, { className, ...scope }).kind !== 'none';
}

/** Top-level FQNs on the classpath whose simple name is `simple` (exact first, then case-insensitive). */
function lookupBySimpleName(
  projectRoot: string,
  output: ResolutionOutput,
  simple: string,
  scope: Scope,
): string[] {
  const modules =
    scope.modulePath !== undefined && scope.modulePath.length > 0
      ? [scope.modulePath]
      : output.modules.map((m) => m.name);
  const exact = new Set<string>();
  const loose = new Set<string>();
  const lower = simple.toLowerCase();
  for (const modulePath of modules) {
    const picked = pickResolvedConfiguration(output, { ...scope, modulePath });
    if (!picked.ok) {
      continue;
    }
    const ensured = ensureClassSearchIndex(projectRoot, output, {
      module: picked.module,
      configuration: picked.configuration,
      includeTest: Boolean(scope.includeTest),
    });
    if (!ensured.ok) {
      continue;
    }
    for (const e of ensured.file.entries) {
      if (e.simpleName === simple) {
        exact.add(e.className);
      } else if (e.simpleName.toLowerCase() === lower) {
        loose.add(e.className);
      }
    }
  }
  return [...(exact.size > 0 ? exact : loose)].sort();
}

/**
 * Makes `className` forgiving for agents:
 * - strips `.class` / `.java`, accepts `/` separators;
 * - `Outer.Inner` ↔ `Outer$Inner` (tries `$` for trailing segments when the dotted name is not on the classpath);
 * - a bare simple name (optionally `Outer.Inner`) is resolved through the class-search index:
 *   one hit proceeds, several return an `INVALID_FQN` pick list.
 * Anything it cannot improve is returned unchanged so downstream validation / CLASS_NOT_FOUND still apply.
 */
export function canonicalizeClassName(
  projectRoot: string,
  output: ResolutionOutput,
  rawClassName: string,
  rawScope: Scope,
): CanonicalClassName {
  const scope = withoutAllModules(rawScope);
  const name = normalizeClassNameSyntax(rawClassName);
  const segs = name.split('.');
  if (!segs.every((s) => SEGMENT.test(s))) {
    return { ok: true, className: name };
  }
  const unchanged: CanonicalClassName = { ok: true, className: name };
  try {
    if (existsInScope(output, name, scope)) {
      return unchanged;
    }

    for (let i = segs.length - 1; i >= 1 && /^[A-Z]/.test(segs[i - 1]!); i--) {
      const candidate = `${segs.slice(0, i).join('.')}$${segs.slice(i).join('$')}`;
      if (existsInScope(output, candidate, scope)) {
        return { ok: true, className: candidate, resolvedFrom: name };
      }
    }

    if (segs.length === 1 || /^[A-Z]/.test(segs[0]!)) {
      const rest = segs.slice(1).join('$');
      const bases = lookupBySimpleName(projectRoot, output, segs[0]!, scope);
      const candidates = bases
        .map((b) => (rest ? `${b}$${rest}` : b))
        .filter((c) => !rest || existsInScope(output, c, scope));
      if (candidates.length === 1) {
        return { ok: true, className: candidates[0]!, resolvedFrom: name };
      }
      if (candidates.length > 1) {
        const shown = candidates.slice(0, MAX_PICK_LIST);
        const more = candidates.length > shown.length ? ` (and ${candidates.length - shown.length} more)` : '';
        return {
          ok: false,
          error: {
            code: 'INVALID_FQN',
            message:
              `${JSON.stringify(name)} is not fully qualified and matches ${candidates.length} classes: ` +
              `${shown.join(', ')}${more}. Retry with className set to one of these.`,
          },
        };
      }
    }
  } catch {
    /* best-effort: fall through to the original name */
  }
  return unchanged;
}

export type ResolveClassScopeResult =
  | (Extract<ResolveModuleScopeResult, { ok: true }> & { className: string; resolvedFrom?: string })
  | Extract<ResolveModuleScopeResult, { ok: false }>;

/** {@link canonicalizeClassName} followed by {@link resolveModuleScopeOrError}; the success result carries the canonical class name. */
export function resolveClassScopeOrError(
  projectRoot: string,
  output: ResolutionOutput,
  opts: InferModulePathOptions,
): ResolveClassScopeResult {
  const canon = canonicalizeClassName(projectRoot, output, opts.className, opts);
  if (!canon.ok) {
    return { ok: false, error: canon.error };
  }
  const scope = resolveModuleScopeOrError(output, { ...opts, className: canon.className });
  if (!scope.ok) {
    return scope;
  }
  return { ...scope, className: canon.className, resolvedFrom: canon.resolvedFrom };
}
