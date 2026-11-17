import type { ClassSourceError, ClassSourceLookupResult } from './class-source-types.js';
import { locateKotlinTypeDeclaration } from '../class-structure/kotlin/locate-kotlin-declaration.js';
import { locateTypeDeclaration } from '../class-structure/locate-type-declaration.js';

type ClassSourceSuccess = Extract<ClassSourceLookupResult, { ok: true }>;

/** Simple names from the binary name: `com.foo.Outer$Inner` → `['Outer', 'Inner']`. */
export function nestedTypeNames(className: string): string[] {
  const dot = className.lastIndexOf('.');
  const simple = dot < 0 ? className : className.slice(dot + 1);
  return simple.split('$');
}

/**
 * `Outer$1` and `Outer$Inner$1` are anonymous or local classes. There is no source declaration to return.
 * Named local classes (`Outer$1Local`) are not matched.
 */
export function anonymousOrLocalClassError(className: string): ClassSourceError | null {
  const dollar = className.lastIndexOf('$');
  if (dollar < 0) {
    return null;
  }
  const last = className.slice(dollar + 1);
  if (!/^\d+$/.test(last)) {
    return null;
  }
  const enclosing = className.slice(0, dollar);
  return {
    code: 'CLASS_NOT_FOUND',
    message: `${className} is an anonymous or local class. The enclosing class is ${enclosing}.`,
    className,
    searchedArtifactCount: 0,
  };
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

/** One header line plus the declaration. Line numbers are 1-based positions in `source`. */
export function formatNestedSlice(
  source: string,
  sourceRelPath: string,
  span: { start: number; closeBrace: number },
): string {
  const startLine = lineNumberAt(source, span.start);
  const endLine = lineNumberAt(source, span.closeBrace);
  const header = `// jvmsrc: ${sourceRelPath}:${startLine}-${endLine}\n`;
  return header + source.slice(span.start, span.closeBrace + 1);
}

function withSourceProvenance(
  result: ClassSourceSuccess,
  nestedIn: string | null,
  sourceRelPath: string,
): ClassSourceSuccess {
  const p = result.provenance;
  if (p.kind === 'sourcesJar' || p.kind === 'interproject') {
    return {
      ...result,
      provenance: { ...p, ...(nestedIn === null ? {} : { nestedIn }), sourceRelativePath: sourceRelPath },
    };
  }
  return result;
}

function fileStem(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

/**
 * When `sourceRelPath` is not the file named after `className` (an enclosing file, or the
 * `SourceFile` of a secondary top-level class), replace `source` with the declaration slice
 * and keep the file on `compilationUnit`.
 * A Java file that does not declare the type gives null (try the next candidate).
 * A Kotlin file is sliced the same way, except that a file named after the top-level class is
 * returned whole, and so is a file with no such type (a `FooKt` facade).
 * Scala and Groovy files are returned whole.
 * An exact `Outer$Inner.java` hit is returned unsliced, with `nestedIn` set.
 */
export function presentNestedSource(
  result: ClassSourceSuccess,
  className: string,
  sourceRelPath: string,
  exactSourceRelPath: string,
): ClassSourceSuccess | null {
  const dollar = className.lastIndexOf('$');
  const nestedIn = dollar < 0 ? null : className.slice(0, dollar);
  if (sourceRelPath === exactSourceRelPath) {
    return nestedIn === null ? result : withSourceProvenance(result, nestedIn, sourceRelPath);
  }
  const marked = withSourceProvenance(result, nestedIn, sourceRelPath);
  const names = nestedTypeNames(className);
  if (sourceRelPath.endsWith('.kt')) {
    if (nestedIn === null && fileStem(sourceRelPath) === names[0]) {
      return marked;
    }
    const kotlinSpan = locateKotlinTypeDeclaration(result.source, names);
    if (!kotlinSpan) {
      return marked;
    }
    return {
      ...marked,
      source: formatNestedSlice(result.source, sourceRelPath, kotlinSpan),
      compilationUnit: result.source,
    };
  }
  if (!sourceRelPath.endsWith('.java')) {
    return marked;
  }
  const span = locateTypeDeclaration(result.source, names);
  if (!span) {
    return null;
  }
  return {
    ...marked,
    source: formatNestedSlice(result.source, sourceRelPath, span),
    compilationUnit: result.source,
  };
}
