import type { ArtifactCoordinates, DecompiledProvenance } from '../extractor/class-source-types.js';
import {
  getDecompiledCacheFilePath,
  readDecompiledCacheFile,
  writeDecompiledCacheFile,
} from '../cache/decompiled-paths.js';
import { resolveJavaExecutable } from './resolve-java-executable.js';
import { runCfrDecompile } from './spawn-cfr.js';

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
    },
  };
}

export async function decompileExternalClass(
  opts: DecompileExternalClassOptions,
): Promise<DecompileExternalClassResult> {
  const cachePathResult = getDecompiledCacheFilePath(opts.coordinates, opts.className);
  if (!cachePathResult.ok) {
    return failure(opts, cachePathResult.message);
  }

  const cachePath = cachePathResult.cachePath;
  const cached = readDecompiledCacheFile(cachePath);
  if (cached !== null) {
    return {
      ok: true,
      source: cached,
      sourceAvailable: false,
      className: opts.className,
      provenance: {
        kind: 'decompiled',
        coordinates: opts.coordinates,
        jarPath: opts.jarPath,
        entryRelPath: opts.entryRelPath,
        cachePath,
      },
    };
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
    return failure(opts, cfr.message, cfr.stderr);
  }

  try {
    writeDecompiledCacheFile(cachePath, cfr.source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failure(opts, `Failed to write decompilation cache: ${msg}`);
  }

  return {
    ok: true,
    source: cfr.source,
    sourceAvailable: false,
    className: opts.className,
    provenance: {
      kind: 'decompiled',
      coordinates: opts.coordinates,
      jarPath: opts.jarPath,
      entryRelPath: opts.entryRelPath,
      cachePath,
    },
  };
}
