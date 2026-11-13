const HEAD_LIMIT = 8192;

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function isIdentPart(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

function isPackageName(name: string): boolean {
  if (name.length === 0 || name.startsWith('.') || name.endsWith('.') || name.includes('..')) {
    return false;
  }
  return name.split('.').every((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part));
}

/** Index after a closing `)`, or -1 when the parens are truncated. `open` points at `(`. */
function skipParens(text: string, open: number, limit: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = open; i < limit; i++) {
    const c = text[i]!;
    if (quote !== null) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

/** Index after one annotation, or -1 when it is truncated. `at` points at `@`. */
function skipAnnotation(text: string, at: number, limit: number): number {
  let i = at + 1;
  while (i < limit && /[A-Za-z0-9_$.]/.test(text[i]!)) {
    i++;
  }
  if (text[i] === ':') {
    i++;
    while (i < limit && /[A-Za-z0-9_$.]/.test(text[i]!)) {
      i++;
    }
  }
  while (i < limit && isSpace(text[i]!)) {
    i++;
  }
  if (text[i] === '(') {
    return skipParens(text, i, limit);
  }
  return i;
}

/**
 * The first `package` declaration in `text`, or null for the default package.
 * Skips comments, a BOM and file annotations (`@file:JvmName(...)`).
 */
export function packageNameFromSource(text: string): string | null {
  const limit = Math.min(text.length, HEAD_LIMIT);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < limit) {
    const c = text[i]!;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      if (nl < 0 || nl >= limit) {
        return null;
      }
      i = nl + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0 || end >= limit) {
        return null;
      }
      i = end + 2;
      continue;
    }
    if (c === '@') {
      const next = skipAnnotation(text, i, limit);
      if (next < 0) {
        return null;
      }
      i = next;
      continue;
    }
    if (text.startsWith('package', i) && !isIdentPart(text[i + 7])) {
      i += 'package'.length;
      while (i < limit && isSpace(text[i]!)) {
        i++;
      }
      const start = i;
      while (i < limit && /[A-Za-z0-9_$.]/.test(text[i]!)) {
        i++;
      }
      const name = text.slice(start, i);
      return isPackageName(name) ? name : null;
    }
    return null;
  }
  return null;
}
