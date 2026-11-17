import { decompileExternalClass } from '../decompiler/decompile-external-class.js';
import {
  sourceLanguageFromPath,
  type ClassSourceLookupOptions,
  type ClassSourceLookupResult,
} from './class-source-types.js';
import { presentNestedSource } from './nested-class-source.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { walkSourceCandidates } from './walk-source-candidates.js';

/**
 * Locates source for a class from a pre-resolved classpath, falling back to CFR decompilation.
 * Sources JARs are not bulk-fetched at resolve time; pass `resolveSourcesJar` to download/read
 * sources only for the winning artifact. A nested type is returned as its declaration slice.
 */
export async function extractExternalClassSource(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): Promise<ClassSourceLookupResult> {
  const walked = await walkSourceCandidates<Extract<ClassSourceLookupResult, { ok: true }>>(output, opts, {
    allowsFile: () => true,
    accept: (hit, className, openedRel, exactRel) =>
      presentNestedSource(
        {
          ok: true,
          source: hit.source,
          sourceAvailable: true,
          sourceLanguage: sourceLanguageFromPath(openedRel),
          className,
          provenance: hit.provenance,
        },
        className,
        openedRel,
        exactRel,
      ),
  });
  if (walked.kind === 'hit') {
    return walked.value;
  }
  if (walked.kind === 'error') {
    return { ok: false, error: walked.error };
  }

  const { jar } = walked;
  const decompile = opts.decompileExternalClass ?? decompileExternalClass;
  const decompiled = await decompile({
    className: opts.className,
    jarPath: jar.classpath,
    entryRelPath: jar.classRelPath,
    coordinates: jar.coordinates,
    onBeforeCfr: opts.onBeforeDecompile,
  });
  if (decompiled.ok) {
    return decompiled;
  }
  return { ok: false, error: decompiled.error };
}
