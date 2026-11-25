import {
  sourceLanguageFromPath,
  type ClassSourceError,
  type ClassSourceLookupOptions,
  type InterprojectProvenance,
  type SourceLanguage,
  type SourcesJarProvenance,
} from './class-source-types.js';
import { findKotlinTypeDeclaration } from '../class-structure/kotlin/locate-kotlin-declaration.js';
import { locateTypeDeclaration } from '../class-structure/locate-type-declaration.js';
import { nestedTypeNames } from './nested-class-source.js';
import type { FindClasspathOwningClassResult } from './find-external-class-jar.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { walkSourceCandidates, type RawSourceHit } from './walk-source-candidates.js';

export type TryReadSourceFromClasspathResult =
  | {
      ok: true;
      hit: true;
      sourceText: string;
      sourceLanguage: SourceLanguage;
      provenance: SourcesJarProvenance | InterprojectProvenance;
    }
  | { ok: true; hit: false }
  | { ok: false; error: ClassSourceError };

export type TryReadJavaSourceFromClasspathResult = TryReadSourceFromClasspathResult;

function withNestedReadProvenance(
  provenance: SourcesJarProvenance | InterprojectProvenance,
  className: string,
  sourceRelPath: string,
  exactSourceRelPath: string,
): SourcesJarProvenance | InterprojectProvenance {
  const dollar = className.lastIndexOf('$');
  if (dollar >= 0) {
    return { ...provenance, nestedIn: className.slice(0, dollar), sourceRelativePath: sourceRelPath };
  }
  if (sourceRelPath !== exactSourceRelPath) {
    return { ...provenance, sourceRelativePath: sourceRelPath };
  }
  return provenance;
}

function declaresType(source: string, className: string, language: SourceLanguage, viaSourceFile: boolean): boolean {
  const names = nestedTypeNames(className);
  if (language === 'java') {
    return locateTypeDeclaration(source, names) !== null;
  }
  if (language === 'kotlin') {
    // The class file names this file, so a facade renamed by `@file:JvmName` belongs to it.
    if (viaSourceFile) {
      return true;
    }
    // `FooKt` is the facade of the file's top-level declarations, not a declared type.
    return findKotlinTypeDeclaration(source, names) !== null || (names.length === 1 && names[0]!.endsWith('Kt'));
  }
  return true;
}

/**
 * Full compilation unit for structure and signatures. A file with another name (enclosing file,
 * or the `SourceFile` of a secondary top-level class) is kept only when it declares the type.
 * The text is not sliced; the parser walks the nested binary name.
 */
function acceptFullCompilationUnit(
  hit: RawSourceHit,
  className: string,
  sourceRelPath: string,
  exactSourceRelPath: string,
): Extract<TryReadSourceFromClasspathResult, { hit: true }> | null {
  const sourceLanguage = sourceLanguageFromPath(sourceRelPath);
  if (sourceRelPath !== exactSourceRelPath && !declaresType(hit.source, className, sourceLanguage, hit.viaSourceFile)) {
    return null;
  }
  return {
    ok: true,
    hit: true,
    sourceText: hit.source,
    sourceLanguage,
    provenance: withNestedReadProvenance(hit.provenance, className, sourceRelPath, exactSourceRelPath),
  };
}

/**
 * Classpath-order `.java` read (inter-project edges first, then sources JARs on external jars),
 * mirroring {@link extractExternalClassSource}. Nested names try `Outer$Inner.java`, then each
 * enclosing compilation unit. The result is the full file, not the declaration slice.
 */
export async function tryReadJavaSourceFromClasspath(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
): Promise<TryReadSourceFromClasspathResult> {
  return tryReadSourceFromClasspath(output, opts, ['java']);
}

/**
 * Same classpath-order read as {@link tryReadJavaSourceFromClasspath}, for the listed source
 * languages. A `.kt` file is read through the class's `SourceFile` or the module source roots.
 */
export async function tryReadSourceFromClasspath(
  output: ResolutionOutput,
  opts: ClassSourceLookupOptions,
  languages: readonly SourceLanguage[],
  findBinaryOwner?: () => FindClasspathOwningClassResult,
): Promise<TryReadSourceFromClasspathResult> {
  const walked = await walkSourceCandidates<Extract<TryReadSourceFromClasspathResult, { hit: true }>>(output, opts, {
    findBinaryOwner,
    allowsFile: (name) => languages.includes(sourceLanguageFromPath(name)),
    accept: acceptFullCompilationUnit,
  });
  switch (walked.kind) {
    case 'hit':
      return walked.value;
    case 'error':
      return { ok: false, error: walked.error };
    case 'miss':
      return { ok: true, hit: false };
  }
}
