import path from 'node:path';
import { decompileExternalClass } from './decompiler/decompile-external-class.js';
import { outermostBinaryName } from './decompiler/spawn-cfr.js';
import type { ArtifactCoordinates, ClassSourceError } from './extractor/class-source-types.js';
import { isClasspathBinaryJarArtifact } from './extractor/class-source-types.js';
import { fqnToSourceCandidates, fqnToZipRelPaths } from './extractor/fqn-paths.js';
import { anonymousOrLocalClassError } from './extractor/nested-class-source.js';
import { pickResolvedConfiguration } from './extractor/pick-classpath.js';
import { readZipEntryUtf8, zipEntryExists } from './extractor/zip-entry.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import { createSourcesJarResolver } from './sources-jar-resolver.js';
import type { ResolvedArtifact, ResolutionOutput } from './resolvers/resolution-output.js';
import {
  searchClassSourceTextAsync,
  type ClassSourceTextSearchHit,
  DEFAULT_FIND_CONTEXT_LINES,
  DEFAULT_FIND_MAX_HITS,
  MAX_FIND_MAX_HITS,
} from './class-source-text-search.js';
import { listFqnsFromJarClassEntries } from './class-search/jar-class-fqns.js';
import { RegexMatchRunner } from './regex-match-runner.js';
import { searchJavadocJar } from './search-javadoc.js';
import { resolverById } from './resolvers/index.js';
import type { ResolveJavadocJarResult } from './resolvers/base.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const DEFAULT_SEARCH_IN_ARTIFACT_MAX_CLASSES = 500;
export const MAX_SEARCH_IN_ARTIFACT_MAX_CLASSES = 500;

export type ArtifactSelector = {
  /** Maven coordinates; `version` is optional for a loose match. */
  coordinates?: { group: string; name: string; version?: string | null };
  /** Absolute path to the binary JAR on the resolved classpath. */
  jarPath?: string;
};

export type SearchInArtifactOptions = {
  projectRoot: string;
  selector: ArtifactSelector;
  query: string;
  regex?: boolean;
  contextLines?: number;
  /** Total hit cap across all classes (default 20, max 100). */
  maxHits?: number;
  /** FQN scan cap — classes scanned stops here (default 500). */
  maxClasses?: number;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
  /** Search the artifact's Javadoc JAR (class page prose, literal only) instead of its source. */
  docs?: boolean;
};

/** Options for the lower-level variant that accepts a pre-resolved output (used in tests). */
export type SearchInArtifactFromOutputOptions = Omit<SearchInArtifactOptions, 'projectRoot' | 'forceRefresh'> & {
  projectRoot?: string;
  /** Override sources-JAR resolution (for tests). */
  resolveSourcesJarFn?: (projectRoot: string, coordinates: ArtifactCoordinates) => Promise<string | null>;
  /** Override Javadoc-JAR resolution (for tests). */
  resolveJavadocJarFn?: (
    projectRoot: string,
    coordinates: ArtifactCoordinates,
    moduleName: string,
  ) => Promise<ResolveJavadocJarResult>;
};

export type SearchInArtifactHitClass = {
  className: string;
  sourceAvailable: boolean;
  totalMatches: number;
  hits: ClassSourceTextSearchHit[];
};

export type ArtifactInfo = {
  group: string;
  name: string;
  version: string | null;
  jarPath: string | null;
};

export type SearchInArtifactSuccess = {
  ok: true;
  found: true;
  artifact: ArtifactInfo;
  query: string;
  regex: boolean;
  classesScanned: number;
  totalMatches: number;
  hitCount: number;
  truncated: boolean;
  hits: SearchInArtifactHitClass[];
  /** `true` when the search ran over the Javadoc JAR; hit lines are lines of the page text. */
  docs?: true;
};

export type SearchInArtifactNotFound = {
  ok: true;
  found: false;
  code: 'ARTIFACT_NOT_FOUND' | 'ARTIFACT_AMBIGUOUS';
  message: string;
  candidates?: ArtifactInfo[];
};

export type SearchInArtifactResult =
  | SearchInArtifactSuccess
  | SearchInArtifactNotFound
  | { ok: false; error: ClassSourceError };

// ---------------------------------------------------------------------------
// Artifact selection helpers
// ---------------------------------------------------------------------------

function artifactInfo(a: ResolvedArtifact): ArtifactInfo {
  return { group: a.group, name: a.name, version: a.version, jarPath: a.jarPath };
}

function matchesByJarPath(a: ResolvedArtifact, jarPath: string): boolean {
  if (a.jarPath === null) return false;
  return path.resolve(a.jarPath) === path.resolve(jarPath);
}

function matchesByCoordinates(
  a: ResolvedArtifact,
  coords: NonNullable<ArtifactSelector['coordinates']>,
): boolean {
  if (a.group !== coords.group || a.name !== coords.name) return false;
  if (coords.version != null && a.version !== coords.version) return false;
  return true;
}

export function selectArtifact(
  artifacts: ResolvedArtifact[],
  selector: ArtifactSelector,
): SearchInArtifactNotFound | { matched: ResolvedArtifact } {
  if (!selector.coordinates && !selector.jarPath) {
    return {
      ok: true,
      found: false,
      code: 'ARTIFACT_NOT_FOUND',
      message: 'At least one of coordinates or jarPath must be provided.',
    };
  }

  let candidates: ResolvedArtifact[];

  if (selector.jarPath) {
    candidates = artifacts.filter((a) => matchesByJarPath(a, selector.jarPath!));
    if (candidates.length === 0) {
      return {
        ok: true,
        found: false,
        code: 'ARTIFACT_NOT_FOUND',
        message: `No artifact with jarPath ${JSON.stringify(selector.jarPath)} found on the resolved classpath.`,
      };
    }
    // Exact jarPath → always unambiguous (same file = same artifact).
    return { matched: candidates[0]! };
  }

  // coordinates match
  const coords = selector.coordinates!;
  candidates = artifacts.filter((a) => matchesByCoordinates(a, coords));

  if (candidates.length === 0) {
    const coordStr = [coords.group, coords.name, coords.version].filter(Boolean).join(':');
    return {
      ok: true,
      found: false,
      code: 'ARTIFACT_NOT_FOUND',
      message: `No artifact matching ${JSON.stringify(coordStr)} found on the resolved classpath.`,
    };
  }

  // When version was omitted there may be multiple matches (different versions or configs).
  // Deduplicate by jarPath; if still multiple distinct JARs → AMBIGUOUS.
  const uniqueJarPaths = new Set(candidates.map((a) => a.jarPath ?? ''));
  if (uniqueJarPaths.size > 1) {
    return {
      ok: true,
      found: false,
      code: 'ARTIFACT_AMBIGUOUS',
      message:
        `Coordinates ${JSON.stringify(coords.group + ':' + coords.name)} match multiple artifacts with different JAR paths. ` +
        `Add a version or use jarPath to disambiguate.`,
      candidates: candidates.map(artifactInfo),
    };
  }

  return { matched: candidates[0]! };
}

// ---------------------------------------------------------------------------
// Per-class source fetch
// ---------------------------------------------------------------------------

async function fetchClassSource(
  fqn: string,
  artifact: ResolvedArtifact,
  sourcesJarPath: string | null,
): Promise<{
  source: string;
  sourceAvailable: boolean;
  sourceRelPath?: string;
  decompiledOuter?: string;
} | null> {
  // Try sources JAR first (fast, no Java process). Exact `Outer$Inner.java` only;
  // the enclosing file is searched with the outer class.
  if (sourcesJarPath) {
    const paths = fqnToZipRelPaths(fqn);
    if (paths.ok) {
      const entry = readZipEntryUtf8(sourcesJarPath, paths.sourceRelPath);
      if (entry.ok) {
        return { source: entry.text, sourceAvailable: true, sourceRelPath: paths.sourceRelPath };
      }
    }
  }

  // Fallback: CFR decompilation
  if (artifact.jarPath === null) return null;
  const paths = fqnToZipRelPaths(fqn);
  if (!paths.ok) return null;

  const coordinates: ArtifactCoordinates = {
    group: artifact.group,
    name: artifact.name,
    version: artifact.version,
  };

  const result = await decompileExternalClass({
    className: fqn,
    jarPath: artifact.jarPath,
    entryRelPath: paths.classRelPath,
    coordinates,
  });

  if (result.ok) {
    return {
      source: result.source,
      sourceAvailable: false,
      // A top-level decompile includes nested types. A nested slice does not cover its siblings.
      decompiledOuter: fqn.includes('$') ? undefined : outermostBinaryName(fqn),
    };
  }
  return null;
}

/** Outers first, so a nested class can see that its enclosing file was already searched. */
function orderScanFqns(fqns: string[]): string[] {
  return fqns
    .filter((fqn) => anonymousOrLocalClassError(fqn) === null)
    .sort((a, b) => {
      const depth = a.split('$').length - b.split('$').length;
      if (depth !== 0) {
        return depth;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

function hasOwnSourceFile(sourcesJarPath: string | null, exactRelPath: string): boolean {
  if (!sourcesJarPath) {
    return false;
  }
  const exists = zipEntryExists(sourcesJarPath, exactRelPath);
  return exists.ok && exists.exists;
}

/**
 * Skip `Outer$Inner` when the enclosing compilation unit was already searched,
 * unless this nested type has its own `Outer$Inner.java`.
 */
function skipNestedAlreadyScanned(
  fqn: string,
  sourcesJarPath: string | null,
  scannedSourcePaths: ReadonlySet<string>,
  scannedDecompiledOuters: ReadonlySet<string>,
): boolean {
  if (!fqn.includes('$')) {
    return false;
  }
  const paths = fqnToSourceCandidates(fqn);
  if (!paths.ok) {
    return false;
  }
  const exact = paths.sourceRelPaths[0]!;
  if (hasOwnSourceFile(sourcesJarPath, exact)) {
    return false;
  }
  if (scannedDecompiledOuters.has(outermostBinaryName(fqn))) {
    return true;
  }
  for (const enclosing of paths.sourceRelPaths.slice(1)) {
    if (scannedSourcePaths.has(enclosing)) {
      return true;
    }
  }
  return false;
}

async function searchArtifactDocs(
  output: ResolutionOutput,
  opts: SearchInArtifactFromOutputOptions,
  artifact: ResolvedArtifact,
  moduleName: string,
  limits: { maxHits: number; contextLines: number; maxClasses: number; regex: boolean },
): Promise<SearchInArtifactResult> {
  const projectRoot = opts.projectRoot ?? output.projectRoot;
  if (artifact.jarPath === null) return { ok: false, error: { code: 'DOCS_NOT_FOUND', message: 'Artifact has no binary JAR.' } };
  const coordinates: ArtifactCoordinates = { group: artifact.group, name: artifact.name, version: artifact.version };
  const resolver = resolverById(output.buildSystem.type);
  const lookup = opts.resolveJavadocJarFn ?? resolver?.resolveJavadocJar?.bind(resolver);
  if (!lookup || artifact.origin !== 'external') {
    return { ok: false, error: { code: 'DOCS_NOT_FOUND', message: 'Javadoc JARs are resolved only for external dependencies.' } };
  }
  const javadoc = await lookup(projectRoot, coordinates, moduleName);
  if (!javadoc.ok) return { ok: false, error: { code: 'DOCS_RESOLVE_FAILED', message: javadoc.message } };
  if (javadoc.javadocJarPath === null) {
    return { ok: false, error: { code: 'DOCS_NOT_FOUND', message: `No javadoc JAR published for ${artifact.group}:${artifact.name}:${artifact.version ?? ''}.` } };
  }
  const listed = listFqnsFromJarClassEntries(artifact.jarPath, { includeNested: true });
  if (!listed.ok) {
    return { ok: false, error: { code: 'ZIP_READ_ERROR', message: listed.message, jarPath: artifact.jarPath } };
  }
  const ordered = orderScanFqns(listed.fqns);
  const found = await searchJavadocJar(javadoc.javadocJarPath, ordered, { ...opts, ...limits });
  if (!found.ok) return found;
  return {
    ok: true,
    found: true,
    artifact: artifactInfo(artifact),
    query: opts.query,
    regex: false,
    classesScanned: found.classesScanned,
    totalMatches: found.totalMatches,
    hitCount: found.hitCount,
    truncated: found.truncated || ordered.length > limits.maxClasses,
    hits: found.hits,
    docs: true,
  };
}

// ---------------------------------------------------------------------------
// Core search logic (accepts pre-resolved output; exported for tests)
// ---------------------------------------------------------------------------

export async function searchInArtifactFromOutput(
  output: ResolutionOutput,
  opts: SearchInArtifactFromOutputOptions,
): Promise<SearchInArtifactResult> {
  const projectRoot = opts.projectRoot ?? output.projectRoot;

  // 1–2. Pick configuration and collect candidate artifacts. Without modulePath on a multi-module
  // build, look in every module that has the classpath: differing versions then surface as
  // ARTIFACT_AMBIGUOUS (with candidates) instead of a module error.
  const picked = pickResolvedConfiguration(output, {
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  let binaryArtifacts: ResolvedArtifact[];
  const moduleOf = new Map<ResolvedArtifact, string>();
  if (picked.ok) {
    binaryArtifacts = picked.configuration.artifacts.filter(isClasspathBinaryJarArtifact);
    for (const a of binaryArtifacts) moduleOf.set(a, picked.module.name);
  } else if (picked.error.code === 'MODULE_AMBIGUOUS' && picked.error.className === undefined) {
    const seen = new Set<string>();
    binaryArtifacts = [];
    for (const modulePath of picked.error.modulePaths) {
      const each = pickResolvedConfiguration(output, {
        modulePath,
        configuration: opts.configuration,
        includeTest: opts.includeTest,
      });
      if (!each.ok) {
        continue;
      }
      for (const a of each.configuration.artifacts.filter(isClasspathBinaryJarArtifact)) {
        const key = `${a.group}:${a.name}:${a.version ?? ''}|${a.jarPath ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          binaryArtifacts.push(a);
          moduleOf.set(a, each.module.name);
        }
      }
    }
  } else {
    return { ok: false, error: picked.error };
  }

  // 2b. Select artifact
  const selection = selectArtifact(binaryArtifacts, opts.selector);
  if ('ok' in selection && selection.found === false) {
    return selection;
  }
  const artifact = (selection as { matched: ResolvedArtifact }).matched;

  // 3. Clamp params
  const maxHits = Math.min(
    Math.max(1, Math.floor(opts.maxHits ?? DEFAULT_FIND_MAX_HITS)),
    MAX_FIND_MAX_HITS,
  );
  const maxClasses = Math.min(
    Math.max(1, Math.floor(opts.maxClasses ?? DEFAULT_SEARCH_IN_ARTIFACT_MAX_CLASSES)),
    MAX_SEARCH_IN_ARTIFACT_MAX_CLASSES,
  );
  const contextLines = Math.min(50, Math.max(0, Math.floor(opts.contextLines ?? DEFAULT_FIND_CONTEXT_LINES)));
  const regex = Boolean(opts.regex);

  if (opts.docs) {
    return searchArtifactDocs(output, opts, artifact, moduleOf.get(artifact) ?? '', {
      maxHits, contextLines, maxClasses, regex,
    });
  }

  // 4. Resolve sources JAR once for the artifact
  let sourcesJarPath: string | null = artifact.sourcesJarPath ?? null;
  if ((sourcesJarPath === null || sourcesJarPath.length === 0) && artifact.origin === 'external') {
    const coordinates: ArtifactCoordinates = {
      group: artifact.group,
      name: artifact.name,
      version: artifact.version,
    };
    if (opts.resolveSourcesJarFn) {
      sourcesJarPath = await opts.resolveSourcesJarFn(projectRoot, coordinates);
    } else {
      const resolveSources = createSourcesJarResolver({
        projectRoot,
        buildSystem: output.buildSystem.type,
        operation: 'search_in_artifact',
        input: {
          query: opts.query,
          regex,
          coordinates: opts.selector.coordinates,
          jarPath: opts.selector.jarPath,
          modulePath: opts.modulePath,
          configuration: opts.configuration,
          includeTest: opts.includeTest,
        },
      });
      sourcesJarPath = await resolveSources(coordinates);
    }
  }

  // 5. Enumerate FQNs from binary JAR
  if (artifact.jarPath === null) {
    return {
      ok: true,
      found: true,
      artifact: artifactInfo(artifact),
      query: opts.query,
      regex,
      classesScanned: 0,
      totalMatches: 0,
      hitCount: 0,
      truncated: false,
      hits: [],
    };
  }

  const fqnResult = listFqnsFromJarClassEntries(artifact.jarPath, { includeNested: true });
  if (!fqnResult.ok) {
    return {
      ok: false,
      error: { code: 'ZIP_READ_ERROR', message: fqnResult.message, jarPath: artifact.jarPath },
    };
  }

  // 6. Search across classes
  const orderedFqns = orderScanFqns(fqnResult.fqns);
  const allFqns = orderedFqns.slice(0, maxClasses);
  const classHits: SearchInArtifactHitClass[] = [];
  let totalMatches = 0;
  let totalHitCount = 0;
  let truncated = false;
  let classesScanned = 0;
  const scannedSourcePaths = new Set<string>();
  const scannedDecompiledOuters = new Set<string>();
  const runner = regex ? new RegexMatchRunner() : undefined;

  try {
    for (const fqn of allFqns) {
      if (totalHitCount >= maxHits) {
        truncated = true;
        break;
      }
      if (skipNestedAlreadyScanned(fqn, sourcesJarPath, scannedSourcePaths, scannedDecompiledOuters)) {
        continue;
      }

      const sourceResult = await fetchClassSource(fqn, artifact, sourcesJarPath);
      classesScanned++;

      if (sourceResult === null) continue;
      if (sourceResult.sourceRelPath) {
        scannedSourcePaths.add(sourceResult.sourceRelPath);
      }
      if (sourceResult.decompiledOuter) {
        scannedDecompiledOuters.add(sourceResult.decompiledOuter);
      }

      const remaining = maxHits - totalHitCount;
      const searchResult = await searchClassSourceTextAsync(
        sourceResult.source,
        { query: opts.query, contextLines, maxHits: remaining, regex },
        runner,
      );

      if ('error' in searchResult) {
        // Invalid pattern or regex timeout: the same failure would repeat for every class.
        if (searchResult.error.code === 'FIND_QUERY_INVALID') {
          return { ok: false, error: { code: 'FIND_QUERY_INVALID', message: searchResult.error.message } };
        }
        // FIND_SOURCE_TOO_LARGE for a single class: skip silently
        continue;
      }

      totalMatches += searchResult.totalMatches;

      if (searchResult.hits.length > 0) {
        classHits.push({
          className: fqn,
          sourceAvailable: sourceResult.sourceAvailable,
          totalMatches: searchResult.totalMatches,
          hits: searchResult.hits,
        });
        totalHitCount += searchResult.hits.length;
      }

      if (searchResult.truncated) {
        truncated = true;
        break;
      }
    }
  } finally {
    await runner?.close();
  }

  // Mark truncated if we didn't finish all FQNs
  if (!truncated && orderedFqns.length > maxClasses) {
    truncated = true;
  }

  return {
    ok: true,
    found: true,
    artifact: artifactInfo(artifact),
    query: opts.query,
    regex,
    classesScanned,
    totalMatches,
    hitCount: totalHitCount,
    truncated,
    hits: classHits,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function searchInArtifact(
  opts: SearchInArtifactOptions,
): Promise<SearchInArtifactResult> {
  const resolved = await resolveWithResolutionCache(opts.projectRoot, {
    forceRefresh: Boolean(opts.forceRefresh),
    diagnosticOperation: 'search_in_artifact',
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: { code: 'RESOLUTION_FAILED', message: resolved.message, stderr: resolved.stderr },
    };
  }

  return searchInArtifactFromOutput(resolved.output, opts);
}
