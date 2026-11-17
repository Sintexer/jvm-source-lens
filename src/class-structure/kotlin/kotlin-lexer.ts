/**
 * Small lexical helpers for Kotlin source. They are not a parser: they skip text that can hide
 * braces (comments, strings, templates, char literals) so structure scans stay correct.
 */

export function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function skipBlockComment(src: string, i: number, limit: number): number {
  let depth = 0;
  let j = i;
  while (j < limit) {
    if (src[j] === '/' && src[j + 1] === '*') {
      depth++;
      j += 2;
    } else if (src[j] === '*' && src[j + 1] === '/') {
      depth--;
      j += 2;
      if (depth === 0) {
        return j;
      }
    } else {
      j++;
    }
  }
  return limit;
}

function skipTemplate(src: string, openIdx: number, limit: number): number {
  let depth = 0;
  let j = openIdx;
  while (j < limit) {
    const k = skipKotlinNoise(src, j, limit);
    if (k !== j) {
      j = k;
      continue;
    }
    if (src[j] === '{') {
      depth++;
    } else if (src[j] === '}') {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    }
    j++;
  }
  return limit;
}

function skipString(src: string, i: number, limit: number): number {
  if (src.startsWith('"""', i)) {
    let j = i + 3;
    while (j < limit) {
      if (src[j] === '$' && src[j + 1] === '{') {
        j = skipTemplate(src, j + 1, limit);
        continue;
      }
      if (src.startsWith('"""', j)) {
        j += 3;
        while (src[j] === '"') {
          j++;
        }
        return j;
      }
      j++;
    }
    return limit;
  }
  let j = i + 1;
  while (j < limit) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
    } else if (c === '"') {
      return j + 1;
    } else if (c === '$' && src[j + 1] === '{') {
      j = skipTemplate(src, j + 1, limit);
    } else if (c === '\n') {
      return j;
    } else {
      j++;
    }
  }
  return limit;
}

function skipChar(src: string, i: number, limit: number): number {
  let j = i + 1;
  if (src[j] === '\\') {
    j += 2;
  } else {
    j++;
  }
  while (j < limit && src[j] !== "'" && src[j] !== '\n') {
    j++;
  }
  return src[j] === "'" ? j + 1 : j;
}

/**
 * If a comment, string, char literal or backtick name starts at `i`, returns the index after it
 * (a line comment stops before its newline). Otherwise returns `i`.
 */
export function skipKotlinNoise(src: string, i: number, limit: number = src.length): number {
  const c = src[i];
  const n = src[i + 1];
  if (c === '/' && n === '/') {
    const nl = src.indexOf('\n', i + 2);
    return nl < 0 || nl >= limit ? limit : nl;
  }
  if (c === '/' && n === '*') {
    return skipBlockComment(src, i, limit);
  }
  if (c === '"') {
    return skipString(src, i, limit);
  }
  if (c === "'") {
    return skipChar(src, i, limit);
  }
  if (c === '`') {
    const e = src.indexOf('`', i + 1);
    return e < 0 || e >= limit ? limit : e + 1;
  }
  return i;
}

/** Index of the bracket that closes the one at `openIdx`, or -1. */
export function matchingClose(
  src: string,
  openIdx: number,
  open: string,
  close: string,
  limit: number = src.length,
): number {
  let depth = 0;
  let j = openIdx;
  while (j < limit) {
    const k = skipKotlinNoise(src, j, limit);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = src[j];
    if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
    j++;
  }
  return -1;
}

/** Index after the `>` that closes the `<` at `i`, or -1. A `->` arrow does not count. */
export function skipAngle(src: string, i: number, limit: number = src.length): number {
  let depth = 0;
  let j = i;
  while (j < limit) {
    const k = skipKotlinNoise(src, j, limit);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = src[j];
    if (c === '<') {
      depth++;
    } else if (c === '>' && src[j - 1] !== '-') {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    }
    j++;
  }
  return -1;
}

export type TextPart = { text: string; start: number; end: number };

/** Type-argument text only: names, dots, commas, `?`, `*`, variance, nested `<>`, function types. */
const TYPE_ARGUMENTS = /^<[\w\s.,?*<>:()-]*>$/;

/**
 * Splits `text` on commas outside brackets, generics, strings and comments.
 * After a top-level `=` (a default value), `<` is a type argument list only when it closes
 * on type-only text (`listOf<Int>()`); otherwise it is the less-than operator (`x < y`).
 */
export function splitTopLevel(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let depth = 0;
  let start = 0;
  let afterEquals = false;
  let j = 0;
  while (j < text.length) {
    const k = skipKotlinNoise(text, j);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = text[j];
    if (afterEquals && (c === '<' || c === '>')) {
      // In a default value, angle brackets never change depth: skip type arguments, else an operator.
      if (c === '<') {
        const close = skipAngle(text, j);
        if (close > 0 && TYPE_ARGUMENTS.test(text.slice(j, close))) {
          j = close;
          continue;
        }
      }
    } else if (c === '(' || c === '[' || c === '{' || c === '<') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}' || (c === '>' && text[j - 1] !== '-')) {
      depth = Math.max(0, depth - 1);
    } else if (c === '=' && depth === 0 && text[j + 1] !== '=' && text[j - 1] !== '!' && text[j - 1] !== '<' && text[j - 1] !== '>') {
      afterEquals = true;
    } else if (c === ',' && depth === 0) {
      parts.push({ text: text.slice(start, j), start, end: j });
      start = j + 1;
      afterEquals = false;
    }
    j++;
  }
  parts.push({ text: text.slice(start), start, end: text.length });
  return parts;
}
