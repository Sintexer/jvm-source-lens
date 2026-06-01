import path from 'node:path';
import { decompileExternalClass } from './decompiler/decompile-external-class.js';
import type { ArtifactCoordinates, ClassSourceError } from './extractor/class-source-types.js';
import { isClasspathBinaryJarArtifact } from './extractor/class-source-types.js';
import { fqnToZipRelPaths } from './extractor/fqn-paths.js';
import { pickResolvedConfiguration } from './extractor/pick-classpath.js';
import { readZipEntryUtf8 } from './extractor/zip-entry.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import { resolveSourcesJar } from './resolvers/gradle/resolve-sources-jar.js';
import type { ResolvedArtifact, ResolutionOutput } from './resolvers/resolution-output.js';
import {
  searchClassSourceText,
  type ClassSourceTextSearchHit,
  DEFAULT_FIND_CONTEXT_LINES,
  DEFAULT_FIND_MAX_HITS,
  MAX_FIND_MAX_HITS,
} from './class-source-text-search.js';
import { listFqnsFromJarClassEntries } from './class-search/jar-class-fqns.js';

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
};

/** Options for the lower-level variant that accepts a pre-resolved output (used in tests). */
export type SearchInArtifactFromOutputOptions = Omit<SearchInArtifactOptions, 'projectRoot' | 'forceRefresh'> & {
  projectRoot?: string;
  /** Override sources-JAR resolution (for tests). */
  resolveSourcesJarFn?: (projectRoot: string, coordinates: ArtifactCoordinates) => Promise<string | null>;
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
): Promise<{ source: string; sourceAvailable: boolean } | null> {
  // Try sources JAR first (fast, no Java process)
  if (sourcesJarPath) {
    const paths = fqnToZipRelPaths(fqn);
    if (paths.ok) {
      const entry = readZipEntryUtf8(sourcesJarPath, paths.sourceRelPath);
      if (entry.ok) {
        return { source: entry.text, sourceAvailable: true };
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
    return { source: result.source, sourceAvailable: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core search logic (accepts pre-resolved output; exported for tests)
// ---------------------------------------------------------------------------

export async function searchInArtifactFromOutput(
  output: ResolutionOutput,
  opts: SearchInArtifactFromOutputOptions,
): Promise<SearchInArtifactResult> {
  const projectRoot = opts.projectRoot ?? output.projectRoot;

  // 1. Pick configuration
  const picked = pickResolvedConfiguration(output, {
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!picked.ok) {
    return { ok: false, error: picked.error };
  }

  // 2. Select artifact
  const binaryArtifacts = picked.configuration.artifacts.filter(isClasspathBinaryJarArtifact);
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
      const sjResult = await resolveSourcesJar(projectRoot, coordinates);
      sourcesJarPath = sjResult.ok ? sjResult.sourcesJarPath : null;
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

  const fqnResult = listFqnsFromJarClassEntries(artifact.jarPath);
  if (!fqnResult.ok) {
    return {
      ok: false,
      error: { code: 'ZIP_READ_ERROR', message: fqnResult.message, jarPath: artifact.jarPath },
    };
  }

  // 6. Search across classes
  const allFqns = fqnResult.fqns.slice(0, maxClasses);
  const classHits: SearchInArtifactHitClass[] = [];
  let totalMatches = 0;
  let totalHitCount = 0;
  let truncated = false;
  let classesScanned = 0;

  for (const fqn of allFqns) {
    if (totalHitCount >= maxHits) {
      truncated = true;
      break;
    }

    const sourceResult = await fetchClassSource(fqn, artifact, sourcesJarPath);
    classesScanned++;

    if (sourceResult === null) continue;

    const remaining = maxHits - totalHitCount;
    const searchResult = searchClassSourceText(sourceResult.source, {
      query: opts.query,
      contextLines,
      maxHits: remaining,
      regex,
    });

    if ('error' in searchResult) {
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

  // Mark truncated if we didn't finish all FQNs
  if (!truncated && fqnResult.fqns.length > maxClasses) {
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
