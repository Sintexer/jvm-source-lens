import { sha256File } from '../cache/sha256-file.js';
import type { ArtifactCoordinates, DecompiledProvenance } from '../extractor/class-source-types.js';
import { fqnToZipRelPaths } from '../extractor/fqn-paths.js';
import { formatNestedSlice, nestedTypeNames } from '../extractor/nested-class-source.js';
import { locateTypeDeclaration } from '../class-structure/locate-type-declaration.js';
import {
  getDecompiledCacheFilePath,
  readDecompiledCacheFile,
  writeDecompiledCacheFile,
} from '../cache/decompiled-paths.js';
import { resolveJavaExecutable } from './resolve-java-executable.js';
import { outermostBinaryName, runCfrDecompile } from './spawn-cfr.js';

export type DecompileExternalClassOptions = {
  className: string;
  jarPath: string;
  entryRelPath: string;
  coordinates: ArtifactCoordinates;
  runCfr?: typeof runCfrDecompile;
  /** Invoked only when CFR runs (not on cache hit). */
  onBeforeCfr?: () => void;
};

export type DecompileExternalClassSuccess = {
  ok: true;
  source: string;
  sourceAvailable: false;
  className: string;
  provenance: DecompiledProvenance;
  /** Full outer CFR text when `source` is a nested slice. */
  compilationUnit?: string;
};

export type DecompileExternalClassError = {
  ok: false;
  error: {
    code: 'DECOMPILE_FAILED';
    message: string;
    className: string;
    jarPath: string;
    entryRelPath: string;
    coordinates: ArtifactCoordinates;
    stderr?: string;
  };
};

export type DecompileExternalClassResult = DecompileExternalClassSuccess | DecompileExternalClassError;

export type DecompileExternalClassFn = (
  opts: DecompileExternalClassOptions,
) => Promise<DecompileExternalClassResult>;

function failure(
  opts: DecompileExternalClassOptions,
  message: string,
  stderr?: string,
  command?: string[],
): DecompileExternalClassError {
  return {
    ok: false,
    error: {
      code: 'DECOMPILE_FAILED',
      message,
      className: opts.className,
      jarPath: opts.jarPath,
      entryRelPath: opts.entryRelPath,
      coordinates: opts.coordinates,
      stderr,
      ...(command ? { command } : {}),
    },
  };
}

function presentDecompiled(
  opts: DecompileExternalClassOptions,
  fullSource: string,
  cachePath: string,
): DecompileExternalClassResult {
  const provenance: DecompiledProvenance = {
    kind: 'decompiled',
    coordinates: opts.coordinates,
    jarPath: opts.jarPath,
    entryRelPath: opts.entryRelPath,
    cachePath,
  };
  const dollar = opts.className.lastIndexOf('$');
  if (dollar < 0) {
    return {
      ok: true,
      source: fullSource,
      sourceAvailable: false,
      className: opts.className,
      provenance,
    };
  }

  const span = locateTypeDeclaration(fullSource, nestedTypeNames(opts.className));
  if (!span) {
    return failure(opts, `CFR output did not contain nested type ${opts.className}`);
  }
  const outer = outermostBinaryName(opts.className);
  const outerPath = fqnToZipRelPaths(outer);
  const sourceRelPath = outerPath.ok ? outerPath.sourceRelPath : `${outer}.java`;
  return {
    ok: true,
    source: formatNestedSlice(fullSource, sourceRelPath, span),
    compilationUnit: fullSource,
    sourceAvailable: false,
    className: opts.className,
    provenance: { ...provenance, nestedIn: opts.className.slice(0, dollar) },
  };
}

export async function decompileExternalClass(
  opts: DecompileExternalClassOptions,
): Promise<DecompileExternalClassResult> {
  // Compute JAR content hash so SNAPSHOT/local-Maven republications get distinct cache entries.
  let jarContentHash: string | undefined;
  try {
    jarContentHash = sha256File(opts.jarPath);
  } catch {
    // If the JAR can't be read for hashing, proceed without a hash (legacy path).
  }

  const cacheName = outermostBinaryName(opts.className);
  const cachePathResult = getDecompiledCacheFilePath(opts.coordinates, cacheName, jarContentHash);
  if (!cachePathResult.ok) {
    return failure(opts, cachePathResult.message);
  }

  const cachePath = cachePathResult.cachePath;
  const cached = readDecompiledCacheFile(cachePath);
  if (cached !== null) {
    return presentDecompiled(opts, cached, cachePath);
  }

  const java = resolveJavaExecutable();
  if (!java.ok) {
    return failure(opts, java.message);
  }

  const runCfr = opts.runCfr ?? runCfrDecompile;
  opts.onBeforeCfr?.();
  const cfr = await runCfr({
    jarPath: opts.jarPath,
    className: opts.className,
    javaPath: java.javaPath,
  });

  if (!cfr.ok) {
    return failure(opts, cfr.message, cfr.stderr, cfr.command);
  }

  try {
    writeDecompiledCacheFile(cachePath, cfr.source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failure(opts, `Failed to write decompilation cache: ${msg}`);
  }

  return presentDecompiled(opts, cfr.source, cachePath);
}
