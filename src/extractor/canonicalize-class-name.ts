import { ensureClassSearchIndex } from '../class-search/ensure-class-search-index.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import type { ClassSourceError } from './class-source-types.js';
import {
  inferModulePath,
  probeClassOwner,
  type InferModulePathResult,
  resolveModuleScopeOrError,
  type InferModulePathOptions,
  type ResolveModuleScopeResult,
} from './infer-module-path.js';
import { matchModule, withoutAllModules } from './match-module.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { NOT_FULLY_QUALIFIED_PHRASE } from '../copy/retry-ready-phrases.js';

const SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_PICK_LIST = 10;

export type CanonicalClassName =
  /** `inferred`: the all-modules probe for `className`, when one ran, so callers need not probe again. */
  | { ok: true; className: string; inferred?: InferModulePathResult }
  | { ok: false; error: ClassSourceError };

type Scope = Pick<InferModulePathOptions, 'modulePath' | 'configuration' | 'includeTest'>;

/** `com/foo/Bar.class`, `com.foo.Bar.java`, surrounding whitespace → `com.foo.Bar`. */
export function normalizeClassNameSyntax(raw: string): string {
  const s = raw.trim().replace(/[\\/]+/g, '.');
  const stripped = s.replace(/\.(class|java|kt|scala|groovy)$/, '');
  return stripped.length > 0 ? stripped : s;
}

type ScopeProbe = { exists: boolean; inferred?: InferModulePathResult };

function probeInScope(output: ResolutionOutput, className: string, scope: Scope): ScopeProbe {
  if (scope.modulePath !== undefined && scope.modulePath.length > 0) {
    const matched = matchModule(scope.modulePath, output.modules, output.projectRoot);
    return {
      exists: matched.kind === 'match' && probeClassOwner(output, matched.module.name, { className, ...scope }).owner !== null,
    };
  }
  const inferred = inferModulePath(output, { className, ...scope });
  return { exists: inferred.kind !== 'none', inferred };
}

const existsInScope = (output: ResolutionOutput, className: string, scope: Scope): boolean =>
  probeInScope(output, className, scope).exists;

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
  let unchanged: CanonicalClassName = { ok: true, className: name };
  try {
    const direct = probeInScope(output, name, scope);
    unchanged = { ok: true, className: name, inferred: direct.inferred };
    if (direct.exists) {
      return unchanged;
    }

    for (let i = segs.length - 1; i >= 1 && /^[A-Z]/.test(segs[i - 1]!); i--) {
      const candidate = `${segs.slice(0, i).join('.')}$${segs.slice(i).join('$')}`;
      const nested = probeInScope(output, candidate, scope);
      if (nested.exists) {
        return { ok: true, className: candidate, inferred: nested.inferred };
      }
    }

    if (segs.length === 1 || /^[A-Z]/.test(segs[0]!)) {
      const rest = segs.slice(1).join('$');
      const bases = lookupBySimpleName(projectRoot, output, segs[0]!, scope);
      const candidates = bases
        .map((b) => (rest ? `${b}$${rest}` : b))
        .filter((c) => !rest || existsInScope(output, c, scope));
      if (candidates.length === 1) {
        return { ok: true, className: candidates[0]! };
      }
      if (candidates.length > 1) {
        const shown = candidates.slice(0, MAX_PICK_LIST);
        const more = candidates.length > shown.length ? ` (and ${candidates.length - shown.length} more)` : '';
        return {
          ok: false,
          error: {
            code: 'INVALID_FQN',
            message:
              `${JSON.stringify(name)} ${NOT_FULLY_QUALIFIED_PHRASE} ${candidates.length} classes: ` +
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
  | (Extract<ResolveModuleScopeResult, { ok: true }> & { className: string })
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
  const scope = resolveModuleScopeOrError(output, { ...opts, className: canon.className }, canon.inferred);
  if (!scope.ok) {
    return scope;
  }
  return { ...scope, className: canon.className };
}
