import {
  extendSpanWithLeadingJavadoc,
  findTopLevelTypeKeywordMatch,
  findTypeBodyOpenBrace,
  findTypeKeywordMatchInRange,
  indexOfMatchingBrace,
} from './parse-java-type-metadata.js';

export type TypeDeclarationSpan = {
  /** Index of the leading Javadoc or annotation, else the first modifier / keyword. */
  start: number;
  openBrace: number;
  closeBrace: number;
};

const MODIFIERS = new Set([
  'public',
  'protected',
  'private',
  'static',
  'final',
  'abstract',
  'sealed',
  'non-sealed',
  'strictfp',
]);

/**
 * Locates a nested type by simple names from the outermost declaration inward.
 * `start` includes the Javadoc and annotations immediately before that declaration.
 * Returns null when a name is missing or its braces do not match.
 */
export function locateTypeDeclaration(source: string, names: readonly string[]): TypeDeclarationSpan | null {
  if (names.length === 0 || names.some((name) => name.length === 0)) {
    return null;
  }

  let regionStart = 0;
  let regionEnd = source.length;
  let span: TypeDeclarationSpan | null = null;

  for (let depth = 0; depth < names.length; depth++) {
    const name = names[depth]!;
    const hit =
      depth === 0
        ? findTopLevelTypeKeywordMatch(source, name)
        : findTypeKeywordMatchInRange(source, name, regionStart, regionEnd);
    if (!hit) {
      return null;
    }
    const openBrace = findTypeBodyOpenBrace(source, hit.index);
    if (openBrace < 0 || openBrace >= regionEnd) {
      return null;
    }
    const closeBrace = indexOfMatchingBrace(source, openBrace);
    if (closeBrace < 0) {
      return null;
    }
    span = { start: declarationStart(source, hit.index), openBrace, closeBrace };
    regionStart = openBrace + 1;
    regionEnd = closeBrace;
  }

  return span;
}

function declarationStart(source: string, keywordIdx: number): number {
  let i = keywordIdx;
  while (i > 0) {
    let j = i;
    while (j > 0 && /\s/.test(source[j - 1]!)) {
      j--;
    }
    if (j === 0) {
      break;
    }
    if (j >= 2 && source[j - 1] === '/' && source[j - 2] === '*') {
      const start = source.lastIndexOf('/*', j - 2);
      if (start < 0) {
        break;
      }
      i = start;
      continue;
    }

    const lineStart = source.lastIndexOf('\n', j - 1) + 1;
    const line = source.slice(lineStart, j);
    const slash = line.lastIndexOf('//');
    if (slash >= 0 && line.slice(0, slash).trim() === '') {
      i = lineStart;
      continue;
    }
    const tokenEnd = slash >= 0 ? lineStart + slash : j;
    const annotationAt = annotationEndingAt(source, tokenEnd);
    if (annotationAt !== null) {
      i = annotationAt;
      continue;
    }
    const word = wordEndingAt(source, tokenEnd);
    if (word && MODIFIERS.has(word.word)) {
      i = word.start;
      continue;
    }
    break;
  }
  return extendSpanWithLeadingJavadoc(source, i);
}

function wordEndingAt(src: string, end: number): { word: string; start: number } | null {
  let k = end;
  while (k > 0 && /[A-Za-z0-9_$]/.test(src[k - 1]!)) {
    k--;
  }
  if (k === end) {
    return null;
  }
  if (src.slice(k, end) === 'sealed' && k >= 4 && src.slice(k - 4, k) === 'non-') {
    return { word: 'non-sealed', start: k - 4 };
  }
  return { word: src.slice(k, end), start: k };
}

function annotationEndingAt(src: string, end: number): number | null {
  let nameEnd = end;
  while (nameEnd > 0 && /\s/.test(src[nameEnd - 1]!)) {
    nameEnd--;
  }
  if (nameEnd > 0 && src[nameEnd - 1] === ')') {
    const open = matchingParenBackward(src, nameEnd - 1);
    if (open < 0) {
      return null;
    }
    nameEnd = open;
    while (nameEnd > 0 && /\s/.test(src[nameEnd - 1]!)) {
      nameEnd--;
    }
  }
  let k = nameEnd;
  let sawName = false;
  while (k > 0) {
    const word = wordEndingAt(src, k);
    if (!word) {
      break;
    }
    sawName = true;
    k = word.start;
    if (k > 0 && src[k - 1] === '.') {
      k--;
      while (k > 0 && /\s/.test(src[k - 1]!)) {
        k--;
      }
      continue;
    }
    break;
  }
  if (!sawName || k === 0 || src[k - 1] !== '@') {
    return null;
  }
  return k - 1;
}

function matchingParenBackward(src: string, closeIdx: number): number {
  let depth = 1;
  let i = closeIdx - 1;
  while (i >= 0) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i--;
      while (i >= 0) {
        if (src[i] === '\\') {
          i -= 2;
          continue;
        }
        if (src[i] === quote) {
          i--;
          break;
        }
        i--;
      }
      continue;
    }
    if (c === ')') {
      depth++;
    } else if (c === '(') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i--;
  }
  return -1;
}
