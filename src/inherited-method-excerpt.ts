import { collectMethodSourceSpans, parseJavaTypeMetadata } from './class-structure/parse-java-type-metadata.js';
import { parseJavapClassHeader } from './class-structure/javap-parse.js';
import { spawnJavapVerbose } from './class-structure/spawn-javap.js';
import type { ResolveSourcesJarFn } from './extractor/class-source-types.js';
import { findClasspathOwningClass } from './extractor/find-external-class-jar.js';
import { tryReadJavaSourceFromClasspath } from './extractor/read-java-source-from-classpath.js';
import type { ResolutionOutput } from './resolvers/resolution-output.js';
import {
  EXCERPT_BOUNDARY_MARKER,
  applySourceExcerpt,
  lineCount,
  type InheritedExcerptInfo,
  type SourceExcerptInfo,
  type SourceExcerptError,
  type SourceExcerptRequest,
  normalizeSourceExcerptRequest,
} from './source-excerpt.js';

/** Same visit budget as the `get_class_structure` hierarchy walk (see get-class-structure.ts). */
export const MAX_INHERITED_EXCERPT_VISITS = 64;

/** Minimal `extends`/`implements` shape shared by source-parsed and javap-parsed headers. */
export type SupertypeHeaderLike = {
  superClass: string | null;
  directInterfaces: string[];
};

export type SupertypeSourceResult =
  | { available: true; source: string; header: SupertypeHeaderLike }
  | { available: false; header?: SupertypeHeaderLike };

/** Resolves one supertype FQN to its `.java` source (when available) and header, for hierarchy walking. */
export type ResolveSupertypeFn = (fqn: string) => Promise<SupertypeSourceResult>;

export type InheritedMethodHit = {
  methodName: string;
  declaringClass: string;
  body: string;
};

export type CollectInheritedMethodBodiesResult = {
  hits: InheritedMethodHit[];
  stillUnmatched: string[];
  /** True when the visit cap (`maxVisits`) was hit before the queue drained. */
  visitCapReached: boolean;
};

/**
 * BFS over superclass + interfaces (mirrors get-class-structure.ts's hierarchy walk) looking for
 * method bodies not present in the primary type's own compilation unit. Pure/testable: pass a
 * fake `resolveSupertype` backed by an in-memory FQN -> source map for unit tests.
 */
export async function collectInheritedMethodBodies(args: {
  primaryHeader: SupertypeHeaderLike;
  unmatchedMethodNames: string[];
  resolveSupertype: ResolveSupertypeFn;
  maxVisits?: number;
}): Promise<CollectInheritedMethodBodiesResult> {
  const maxVisits = args.maxVisits ?? MAX_INHERITED_EXCERPT_VISITS;
  const remaining = new Set(args.unmatchedMethodNames);
  const hits: InheritedMethodHit[] = [];
  if (remaining.size === 0) {
    return { hits, stillUnmatched: [], visitCapReached: false };
  }

  const visitQueue: string[] = [];
  const seen = new Set<string>();
  const enqueue = (fqn: string | null | undefined): void => {
    if (!fqn || fqn === 'java.lang.Object' || seen.has(fqn)) {
      return;
    }
    seen.add(fqn);
    visitQueue.push(fqn);
  };
  enqueue(args.primaryHeader.superClass);
  for (const i of args.primaryHeader.directInterfaces) {
    enqueue(i);
  }

  let visits = 0;
  let visitCapReached = false;
  while (visitQueue.length > 0 && remaining.size > 0) {
    if (visits >= maxVisits) {
      visitCapReached = true;
      break;
    }
    const fqn = visitQueue.shift()!;
    visits++;

    const result = await args.resolveSupertype(fqn);
    if (result.available) {
      const spans = collectMethodSourceSpans(result.source, fqn);
      if (spans) {
        for (const name of [...remaining]) {
          const hit = spans.find((s) => s.jvmMethodName === name);
          if (hit) {
            hits.push({ methodName: name, declaringClass: fqn, body: result.source.slice(hit.start, hit.end) });
            remaining.delete(name);
          }
        }
      }
      enqueue(result.header.superClass);
      for (const i of result.header.directInterfaces) {
        enqueue(i);
      }
    } else if (result.header) {
      enqueue(result.header.superClass);
      for (const i of result.header.directInterfaces) {
        enqueue(i);
      }
    }
  }

  return { hits, stillUnmatched: [...remaining], visitCapReached };
}

export type ClasspathSupertypeResolverOptions = {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  resolveSourcesJar?: ResolveSourcesJarFn;
};

/**
 * Production `ResolveSupertypeFn`: prefers sources JAR / inter-project `.java` (via
 * {@link tryReadJavaSourceFromClasspath}); falls back to `javap` header-only (no body) so the
 * walk can still traverse through bytecode-only or JDK supertypes without stalling.
 */
export function createClasspathSupertypeResolver(
  output: ResolutionOutput,
  opts: ClasspathSupertypeResolverOptions,
): ResolveSupertypeFn {
  return async (fqn: string): Promise<SupertypeSourceResult> => {
    const srcRead = await tryReadJavaSourceFromClasspath(output, {
      className: fqn,
      modulePath: opts.modulePath,
      configuration: opts.configuration,
      includeTest: opts.includeTest,
      resolveSourcesJar: opts.resolveSourcesJar,
    });
    if (srcRead.ok && srcRead.hit) {
      const meta = parseJavaTypeMetadata(srcRead.sourceText, fqn);
      if (meta) {
        return {
          available: true,
          source: srcRead.sourceText,
          header: { superClass: meta.header.superClass, directInterfaces: meta.header.directInterfaces },
        };
      }
    }

    const owner = findClasspathOwningClass(output, {
      className: fqn,
      modulePath: opts.modulePath,
      configuration: opts.configuration,
      includeTest: opts.includeTest,
    });
    if (!owner.ok) {
      return { available: false };
    }
    const jp = await spawnJavapVerbose({ classpath: owner.hit.classpath, className: fqn });
    if (!jp.ok) {
      return { available: false };
    }
    const header = parseJavapClassHeader(jp.stdout);
    if (!header) {
      return { available: false };
    }
    return { available: false, header: { superClass: header.superClass, directInterfaces: header.directInterfaces } };
  };
}

export type ApplySourceExcerptWithInheritanceResult =
  | { ok: true; source: string; excerpt: SourceExcerptInfo }
  | { ok: false; error: SourceExcerptError };

function joinPrimaryAndInherited(primarySource: string, hits: InheritedMethodHit[]): string {
  const inheritedText = hits.map((h) => `// declaringClass: ${h.declaringClass}\n${h.body}`).join(EXCERPT_BOUNDARY_MARKER);
  if (primarySource.length === 0) {
    return inheritedText;
  }
  if (inheritedText.length === 0) {
    return primarySource;
  }
  return primarySource + EXCERPT_BOUNDARY_MARKER + inheritedText;
}

/**
 * Wraps {@link applySourceExcerpt}: when `methodNames` are requested and one or more are not
 * found in the primary compilation unit, walks superclasses/interfaces on the classpath
 * (via `resolveSupertype`) for method bodies before giving up. Matches found on a supertype are
 * appended to the returned source with a `// declaringClass: <fqn>` comment and recorded in
 * `excerpt.inheritedExcerpts`.
 */
export async function applySourceExcerptWithInheritance(
  source: string,
  className: string,
  sourceAvailable: boolean,
  request: SourceExcerptRequest | null,
  resolveSupertype: ResolveSupertypeFn | undefined,
): Promise<ApplySourceExcerptWithInheritanceResult | { ok: true; source: string; excerpt?: undefined }> {
  const primary = applySourceExcerpt(source, className, sourceAvailable, request);

  const normalized = request === null ? null : normalizeSourceExcerptRequest(request);
  const requestedMethodNames = normalized?.methodNames ?? [];
  if (requestedMethodNames.length === 0 || !resolveSupertype) {
    return primary;
  }

  const currentlyUnmatched: string[] = primary.ok
    ? primary.excerpt?.unmatchedMethodNames ?? []
    : primary.error.code === 'EXCERPT_NOT_FOUND'
      ? primary.error.unmatchedMethodNames
      : [];

  if (currentlyUnmatched.length === 0) {
    return primary;
  }

  const primaryMeta = parseJavaTypeMetadata(source, className);
  if (!primaryMeta) {
    return primary;
  }

  const walk = await collectInheritedMethodBodies({
    primaryHeader: { superClass: primaryMeta.header.superClass, directInterfaces: primaryMeta.header.directInterfaces },
    unmatchedMethodNames: currentlyUnmatched,
    resolveSupertype,
  });

  if (walk.hits.length === 0) {
    if (!primary.ok && primary.error.code === 'EXCERPT_NOT_FOUND') {
      return {
        ok: false,
        error: {
          ...primary.error,
          message: `${primary.error.message} Also walked superclasses/interfaces on the classpath (up to ${MAX_INHERITED_EXCERPT_VISITS} type(s)) — no matching method body found there either.`,
        },
      };
    }
    return primary;
  }

  const primaryMatched = primary.ok ? primary.excerpt?.matchedMethodNames ?? [] : [];
  const primarySource = primary.ok ? primary.source : '';

  const inheritedByName = new Map(walk.hits.map((h) => [h.methodName, h]));
  const matchedFinal: string[] = [];
  const unmatchedFinal: string[] = [];
  for (const name of requestedMethodNames) {
    if (primaryMatched.includes(name) || inheritedByName.has(name)) {
      matchedFinal.push(name);
    } else {
      unmatchedFinal.push(name);
    }
  }

  const finalSource = joinPrimaryAndInherited(primarySource, walk.hits);
  const inheritedExcerpts: InheritedExcerptInfo[] = walk.hits.map((h) => ({
    methodName: h.methodName,
    declaringClass: h.declaringClass,
  }));

  const primaryExcerpt = primary.ok ? primary.excerpt : undefined;
  const excerpt: SourceExcerptInfo = {
    excerpted: true,
    requestedMethodNames,
    matchedMethodNames: matchedFinal,
    unmatchedMethodNames: unmatchedFinal,
    ...(primaryExcerpt?.startLine !== undefined ? { startLine: primaryExcerpt.startLine } : {}),
    ...(primaryExcerpt?.endLine !== undefined ? { endLine: primaryExcerpt.endLine } : {}),
    lineNumbersReliable: sourceAvailable,
    sourceLineCount: lineCount(finalSource),
    inheritedExcerpts,
  };

  return { ok: true, source: finalSource, excerpt };
}
