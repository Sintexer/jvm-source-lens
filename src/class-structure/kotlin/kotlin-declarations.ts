import { isSpace, matchingClose, skipAngle, skipKotlinNoise } from './kotlin-lexer.js';

/**
 * Structural scan of Kotlin declarations in one region of a source file. It finds where each
 * declaration starts and ends and reads its header (name, receiver, parameter text, type).
 * It does not parse expressions: function bodies and initializers are skipped as text.
 */

export type KotlinAnnotation = {
  name: string;
  /** `get` in `@get:JvmName(...)`, else null. */
  useSite: string | null;
  args: string | null;
};

export type KotlinRawKeyword =
  | 'class'
  | 'interface'
  | 'object'
  | 'fun'
  | 'val'
  | 'var'
  | 'constructor'
  | 'init'
  | 'typealias'
  | 'other';

export type KotlinRawDeclaration = {
  keyword: KotlinRawKeyword;
  modifiers: string[];
  annotations: KotlinAnnotation[];
  /** Normalized KDoc text immediately before the declaration. */
  kdoc: string | null;
  /** Start of the KDoc, else of the first annotation, else of the first modifier or keyword. */
  start: number;
  keywordIndex: number;
  name: string;
  receiver: string | null;
  /** Text inside the parameter list parentheses, or null when there is none. */
  params: string | null;
  /** Absolute offset of the first character of `params`. */
  paramsStart: number;
  /** Absolute offset after the closing parenthesis of the parameter list; -1 when none. */
  paramsEnd: number;
  /** Visibility modifiers written before `constructor` in a class header. */
  ctorModifiers: string[];
  /** Declared type of a property, or the return type of a function. */
  type: string | null;
  /** Body braces of a type or function; -1 when there is no body. */
  openBrace: number;
  closeBrace: number;
  end: number;
  hasGetter: boolean;
  hasSetter: boolean;
};

const MODIFIERS = new Set([
  'public',
  'protected',
  'private',
  'internal',
  'open',
  'final',
  'abstract',
  'sealed',
  'override',
  'suspend',
  'inline',
  'noinline',
  'crossinline',
  'tailrec',
  'operator',
  'infix',
  'external',
  'const',
  'lateinit',
  'expect',
  'actual',
  'vararg',
  'reified',
  'companion',
  'data',
  'enum',
  'annotation',
  'value',
  'inner',
]);

const VISIBILITY = new Set(['public', 'protected', 'private', 'internal']);

const USE_SITES = new Set(['file', 'get', 'set', 'field', 'property', 'param', 'setparam', 'delegate', 'receiver']);

type Word = { text: string; start: number; end: number };

function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

export function readWord(src: string, i: number, limit: number): Word | null {
  if (src[i] === '`') {
    const e = src.indexOf('`', i + 1);
    if (e < 0 || e >= limit) {
      return null;
    }
    return { text: src.slice(i + 1, e), start: i, end: e + 1 };
  }
  if (!/[A-Za-z_$]/.test(src[i] ?? '')) {
    return null;
  }
  let j = i + 1;
  while (j < limit && isIdentChar(src[j])) {
    j++;
  }
  return { text: src.slice(i, j), start: i, end: j };
}

function skipSpaces(src: string, i: number, limit: number): number {
  let j = i;
  while (j < limit) {
    if (isSpace(src[j])) {
      j++;
      continue;
    }
    if (src[j] === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) {
      j = skipKotlinNoise(src, j, limit);
      continue;
    }
    break;
  }
  return j;
}

function skipInlineSpaces(src: string, i: number, limit: number): number {
  let j = i;
  while (j < limit && (src[j] === ' ' || src[j] === '\t')) {
    j++;
  }
  return j;
}

export function normalizeKdoc(raw: string): string {
  const inner = raw.replace(/^\/\*\*/, '').replace(/\*\/$/, '');
  return inner.replace(/^[ \t]*\*[ \t]?/gm, '').trim();
}

function parseAnnotation(src: string, i: number, limit: number): { ann: KotlinAnnotation; end: number } | null {
  let j = i + 1;
  let useSite: string | null = null;
  const site = /^([a-z]+):/.exec(src.slice(j, j + 12));
  if (site && USE_SITES.has(site[1]!)) {
    useSite = site[1]!;
    j += site[0].length;
  }
  const start = j;
  while (j < limit && /[A-Za-z0-9_.$]/.test(src[j]!)) {
    j++;
  }
  if (j === start) {
    return null;
  }
  const full = src.slice(start, j);
  const name = full.slice(full.lastIndexOf('.') + 1);
  let args: string | null = null;
  if (src[j] === '(') {
    const close = matchingClose(src, j, '(', ')', limit);
    if (close < 0) {
      return null;
    }
    args = src.slice(j + 1, close);
    j = close + 1;
  }
  return { ann: { name, useSite, args }, end: j };
}

/** Last significant character before the end of the scanned prefix. Comments are ignored. */
class LastSignificant {
  char = '';
  prev = '';
  idx = -1;
  push(c: string, idx = -1): void {
    this.prev = this.char;
    this.char = c;
    this.idx = idx;
  }
}

function nextSignificantIndex(src: string, i: number, limit: number): number {
  return skipSpaces(src, i, limit);
}

function startsWithWord(src: string, p: number, word: string, limit: number): boolean {
  return src.startsWith(word, p) && p + word.length <= limit && !isIdentChar(src[p + word.length]);
}

/** Does a statement that has reached a newline continue on the next line? */
function continuesAfterNewline(src: string, last: LastSignificant, newlineIdx: number, limit: number): boolean {
  const c = last.char;
  if (c !== '' && '+*%&|=,.:'.includes(c)) {
    return true;
  }
  if (c === '-' || (c === '>' && last.prev === '-')) {
    return true;
  }
  if (c === '/' && last.prev !== '*') {
    return true;
  }
  const p = nextSignificantIndex(src, newlineIdx + 1, limit);
  if (p >= limit) {
    return false;
  }
  const n = src[p];
  const n2 = src[p + 1];
  if (n === '.' && n2 !== '.') {
    return true;
  }
  if ((n === '?' && (n2 === '.' || n2 === ':')) || (n === '&' && n2 === '&') || (n === '|' && n2 === '|')) {
    return true;
  }
  return (
    startsWithWord(src, p, 'else', limit) ||
    startsWithWord(src, p, 'as', limit) ||
    (src.startsWith('as?', p) && !isIdentChar(src[p + 3])) ||
    startsWithWord(src, p, 'by', limit)
  );
}

/** End of an expression or initializer: the newline or `;` that closes the statement. */
function endOfStatement(src: string, from: number, limit: number, seed = ''): number {
  let depth = 0;
  let ifClose = -1;
  let lineIsAnnotation = false;
  let lineHasContent = false;
  const last = new LastSignificant();
  if (seed !== '') {
    last.push(seed);
  }
  let k = from;
  while (k < limit) {
    const n = skipKotlinNoise(src, k, limit);
    if (n !== k) {
      if (src[k] !== '/') {
        last.push('"', n - 1);
        lineHasContent = true;
      }
      k = n;
      continue;
    }
    const c = src[k]!;
    if (!isSpace(c) && !lineHasContent) {
      lineHasContent = true;
      lineIsAnnotation = c === '@';
    }
    if (c === 'i' && depth === 0 && startsWithWord(src, k, 'if', limit) && !isIdentChar(src[k - 1])) {
      const p = skipInlineSpaces(src, k + 2, limit);
      if (src[p] === '(') {
        ifClose = matchingClose(src, p, '(', ')', limit);
      }
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        return k;
      }
      depth--;
    } else if (depth === 0 && c === ';') {
      return k;
    } else if (depth === 0 && c === '\n') {
      const afterIfCondition = last.idx >= 0 && last.idx === ifClose;
      const afterElse =
        last.idx >= 3 && src.slice(last.idx - 3, last.idx + 1) === 'else' && !isIdentChar(src[last.idx - 4]);
      const afterAnnotationLine = lineIsAnnotation;
      if (!afterIfCondition && !afterElse && !afterAnnotationLine && !continuesAfterNewline(src, last, k, limit)) {
        return k;
      }
      lineHasContent = false;
      lineIsAnnotation = false;
    }
    if (!isSpace(c)) {
      last.push(c, k);
    }
    k++;
  }
  return limit;
}

type TypeScan = { text: string; end: number };

/**
 * Reads a declared type starting at `from`, up to `=`, `{`, `;`, `by`, `where` or the end of
 * the line. `end` points at the stopping character.
 */
function scanTypeText(src: string, from: number, limit: number): TypeScan {
  let depth = 0;
  const last = new LastSignificant();
  let k = from;
  while (k < limit) {
    const n = skipKotlinNoise(src, k, limit);
    if (n !== k) {
      if (src[k] !== '/') {
        last.push('"');
      }
      k = n;
      continue;
    }
    const c = src[k]!;
    if (c === '(' || c === '[' || c === '<') {
      depth++;
    } else if (c === ')' || c === ']' || (c === '>' && src[k - 1] !== '-')) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      if (c === '{' || c === ';') {
        break;
      }
      if (c === '=' && src[k + 1] !== '=' && src[k + 1] !== '>') {
        break;
      }
      if (c === '\n') {
        const arrow = last.char === '>' && last.prev === '-';
        if (!(last.char === ',' || last.char === '&' || arrow)) {
          break;
        }
      }
      if (startsWithWord(src, k, 'by', limit) && isSpace(src[k - 1]) && last.char !== '') {
        break;
      }
      if (startsWithWord(src, k, 'where', limit) && isSpace(src[k - 1])) {
        break;
      }
      if ((startsWithWord(src, k, 'get', limit) || startsWithWord(src, k, 'set', limit)) && isSpace(src[k - 1])) {
        break;
      }
    }
    if (!isSpace(c)) {
      last.push(c);
    }
    k++;
  }
  return { text: src.slice(from, k).trim(), end: k };
}

function lastTopLevelDot(text: string): number {
  let depth = 0;
  let idx = -1;
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === '<' || c === '(' || c === '[') {
      depth++;
    } else if ((c === '>' && text[j - 1] !== '-') || c === ')' || c === ']') {
      depth--;
    } else if (c === '.' && depth === 0) {
      idx = j;
    }
  }
  return idx;
}

function splitReceiver(nameText: string): { receiver: string | null; name: string } {
  const t = nameText.trim();
  const dot = lastTopLevelDot(t);
  if (dot < 0) {
    return { receiver: null, name: unquote(t) };
  }
  return { receiver: t.slice(0, dot).trim(), name: unquote(t.slice(dot + 1).trim()) };
}

function unquote(name: string): string {
  return name.startsWith('`') && name.endsWith('`') ? name.slice(1, -1) : name;
}

function emptyDeclaration(start: number, keywordIndex: number): KotlinRawDeclaration {
  return {
    keyword: 'other',
    modifiers: [],
    annotations: [],
    kdoc: null,
    start,
    keywordIndex,
    name: '',
    receiver: null,
    params: null,
    paramsStart: -1,
    paramsEnd: -1,
    ctorModifiers: [],
    type: null,
    openBrace: -1,
    closeBrace: -1,
    end: keywordIndex,
    hasGetter: false,
    hasSetter: false,
  };
}

function scanClassTail(src: string, from: number, limit: number): { openBrace: number; end: number } {
  let depth = 0;
  let angle = 0;
  const last = new LastSignificant();
  let k = from;
  while (k < limit) {
    const n = skipKotlinNoise(src, k, limit);
    if (n !== k) {
      if (src[k] !== '/') {
        last.push('"');
      }
      k = n;
      continue;
    }
    const c = src[k]!;
    if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth = Math.max(0, depth - 1);
    } else if (c === '<') {
      angle++;
    } else if (c === '>' && src[k - 1] !== '-') {
      angle = Math.max(0, angle - 1);
    } else if (depth === 0 && c === '{') {
      return { openBrace: k, end: k };
    } else if (depth === 0 && c === ';') {
      return { openBrace: -1, end: k };
    } else if (depth === 0 && angle === 0 && c === '\n') {
      const p = nextSignificantIndex(src, k + 1, limit);
      const next = src[p];
      const joins =
        last.char === ',' ||
        last.char === ':' ||
        next === '{' ||
        next === ':' ||
        next === ',' ||
        startsWithWord(src, p, 'where', limit) ||
        startsWithWord(src, p, 'by', limit);
      if (!joins) {
        return { openBrace: -1, end: k };
      }
    }
    if (!isSpace(c)) {
      last.push(c);
    }
    k++;
  }
  return { openBrace: -1, end: limit };
}

function parseClassLike(
  d: KotlinRawDeclaration,
  src: string,
  keyword: 'class' | 'interface' | 'object',
  after: number,
  limit: number,
): void {
  d.keyword = keyword;
  let j = skipSpaces(src, after, limit);
  const nameWord = readWord(src, j, limit);
  if (nameWord && !(keyword === 'object' && nameWord.text === 'constructor')) {
    d.name = nameWord.text;
    j = nameWord.end;
  }
  j = skipInlineSpaces(src, j, limit);
  if (src[j] === '<') {
    const k = skipAngle(src, j, limit);
    if (k > 0) {
      j = k;
    }
  }
  let k = skipSpaces(src, j, limit);
  const save = k;
  for (;;) {
    if (src[k] === '@') {
      const a = parseAnnotation(src, k, limit);
      if (!a) {
        break;
      }
      k = skipSpaces(src, a.end, limit);
      continue;
    }
    const w = readWord(src, k, limit);
    if (w && VISIBILITY.has(w.text)) {
      d.ctorModifiers.push(w.text);
      k = skipSpaces(src, w.end, limit);
      continue;
    }
    break;
  }
  const ctor = readWord(src, k, limit);
  if (ctor?.text === 'constructor') {
    k = skipSpaces(src, ctor.end, limit);
  } else {
    k = save;
    d.ctorModifiers = [];
  }
  if (src[k] === '(') {
    const close = matchingClose(src, k, '(', ')', limit);
    if (close > 0) {
      d.params = src.slice(k + 1, close);
      d.paramsStart = k + 1;
      d.paramsEnd = close + 1;
      j = close + 1;
    }
  }
  const tail = scanClassTail(src, j, limit);
  if (tail.openBrace >= 0) {
    const close = matchingClose(src, tail.openBrace, '{', '}', limit);
    d.openBrace = tail.openBrace;
    d.closeBrace = close < 0 ? limit - 1 : close;
    d.end = d.closeBrace + 1;
  } else {
    d.end = tail.end;
  }
}

function parseFunction(d: KotlinRawDeclaration, src: string, after: number, limit: number): void {
  d.keyword = 'fun';
  let j = skipSpaces(src, after, limit);
  if (src[j] === '<') {
    const k = skipAngle(src, j, limit);
    if (k > 0) {
      j = skipSpaces(src, k, limit);
    }
  }
  let angle = 0;
  let open = -1;
  let scanFrom = j;
  if (src[j] === '(') {
    // Receiver written as a parenthesized type: `(suspend () -> T).name(...)`.
    const receiverClose = matchingClose(src, j, '(', ')', limit);
    if (receiverClose > 0) {
      scanFrom = receiverClose + 1;
    }
  }
  for (let k = scanFrom; k < limit; k++) {
    const n = skipKotlinNoise(src, k, limit);
    if (n !== k) {
      k = n - 1;
      continue;
    }
    const c = src[k];
    if (c === '<') {
      angle++;
    } else if (c === '>' && src[k - 1] !== '-') {
      angle = Math.max(0, angle - 1);
    } else if (c === '(' && angle === 0) {
      open = k;
      break;
    } else if (c === '\n' && angle === 0) {
      break;
    }
  }
  if (open < 0) {
    d.keyword = 'other';
    d.end = endOfStatement(src, after, limit);
    return;
  }
  const { receiver, name } = splitReceiver(src.slice(j, open));
  d.receiver = receiver;
  d.name = name;
  const close = matchingClose(src, open, '(', ')', limit);
  if (close < 0) {
    d.end = limit;
    return;
  }
  d.params = src.slice(open + 1, close);
  d.paramsStart = open + 1;
  d.paramsEnd = close + 1;
  let sigEnd = close + 1;
  let k = skipInlineSpaces(src, close + 1, limit);
  if (src[k] === ':') {
    const t = scanTypeText(src, k + 1, limit);
    d.type = t.text.length > 0 ? t.text : null;
    sigEnd = k + 1 + (src.slice(k + 1, t.end).trimEnd().length);
    k = t.end;
  }
  let p = skipSpaces(src, k, limit);
  if (startsWithWord(src, p, 'where', limit)) {
    const w = scanTypeText(src, p + 5, limit);
    sigEnd = w.end;
    p = skipSpaces(src, w.end, limit);
  }
  if (src[p] === '{') {
    const closeBrace = matchingClose(src, p, '{', '}', limit);
    d.openBrace = p;
    d.closeBrace = closeBrace < 0 ? limit - 1 : closeBrace;
    d.end = d.closeBrace + 1;
    return;
  }
  if (src[p] === '=' && src[p + 1] !== '=') {
    d.end = endOfStatement(src, p + 1, limit, '=');
    return;
  }
  d.end = sigEnd;
}

function parseAccessors(d: KotlinRawDeclaration, src: string, limit: number): void {
  for (;;) {
    let p = skipSpaces(src, d.end, limit);
    while (src[p] === '@') {
      const a = parseAnnotation(src, p, limit);
      if (!a) {
        return;
      }
      p = skipSpaces(src, a.end, limit);
    }
    let w = readWord(src, p, limit);
    while (w && VISIBILITY.has(w.text)) {
      p = skipSpaces(src, w.end, limit);
      w = readWord(src, p, limit);
    }
    if (!w || (w.text !== 'get' && w.text !== 'set')) {
      return;
    }
    if (w.text === 'get') {
      d.hasGetter = true;
    } else {
      d.hasSetter = true;
    }
    let k = skipInlineSpaces(src, w.end, limit);
    let end = w.end;
    if (src[k] === '(') {
      const close = matchingClose(src, k, '(', ')', limit);
      if (close < 0) {
        return;
      }
      end = close + 1;
      k = skipInlineSpaces(src, end, limit);
      if (src[k] === ':') {
        const t = scanTypeText(src, k + 1, limit);
        end = t.end;
        k = t.end;
      }
      const q = skipInlineSpaces(src, k, limit);
      if (src[q] === '{') {
        const closeBrace = matchingClose(src, q, '{', '}', limit);
        end = (closeBrace < 0 ? limit - 1 : closeBrace) + 1;
      } else if (src[q] === '=' && src[q + 1] !== '=') {
        end = endOfStatement(src, q + 1, limit, '=');
      }
    }
    d.end = end;
  }
}

function parseProperty(
  d: KotlinRawDeclaration,
  src: string,
  keyword: 'val' | 'var',
  after: number,
  limit: number,
): void {
  d.keyword = keyword;
  let j = skipInlineSpaces(src, after, limit);
  if (src[j] === '<') {
    const k = skipAngle(src, j, limit);
    if (k > 0) {
      j = skipInlineSpaces(src, k, limit);
    }
  }
  let depth = 0;
  let k = j;
  while (k < limit) {
    const n = skipKotlinNoise(src, k, limit);
    if (n !== k) {
      k = n;
      continue;
    }
    const c = src[k]!;
    if (c === '<' || c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']' || (c === '>' && src[k - 1] !== '-')) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (c === ':' || c === '=' || c === '\n' || c === ';')) {
      break;
    } else if (depth === 0 && startsWithWord(src, k, 'by', limit) && isSpace(src[k - 1])) {
      break;
    }
    k++;
  }
  const { receiver, name } = splitReceiver(src.slice(j, k));
  d.receiver = receiver;
  d.name = name;
  if (src[k] === ':') {
    const t = scanTypeText(src, k + 1, limit);
    d.type = t.text.length > 0 ? t.text : null;
    k = t.end;
  }
  const p = skipInlineSpaces(src, k, limit);
  let end: number;
  if (src[p] === '=' && src[p + 1] !== '=') {
    end = endOfStatement(src, p + 1, limit, '=');
  } else if (startsWithWord(src, p, 'by', limit)) {
    end = endOfStatement(src, p + 2, limit, '=');
  } else {
    end = src.slice(0, k).trimEnd().length;
  }
  d.end = Math.max(end, d.keywordIndex);
  parseAccessors(d, src, limit);
}

function parseConstructor(d: KotlinRawDeclaration, src: string, after: number, limit: number): void {
  d.keyword = 'constructor';
  d.name = '<init>';
  const open = skipInlineSpaces(src, after, limit);
  if (src[open] !== '(') {
    d.end = endOfStatement(src, after, limit);
    return;
  }
  const close = matchingClose(src, open, '(', ')', limit);
  if (close < 0) {
    d.end = limit;
    return;
  }
  d.params = src.slice(open + 1, close);
  d.paramsStart = open + 1;
  d.paramsEnd = close + 1;
  let p = skipInlineSpaces(src, close + 1, limit);
  d.end = close + 1;
  if (src[p] === ':') {
    const delegation = scanClassTail(src, p + 1, limit);
    p = delegation.openBrace >= 0 ? delegation.openBrace : delegation.end;
    d.end = delegation.end;
  }
  if (src[p] === '{') {
    const closeBrace = matchingClose(src, p, '{', '}', limit);
    d.openBrace = p;
    d.closeBrace = closeBrace < 0 ? limit - 1 : closeBrace;
    d.end = d.closeBrace + 1;
  }
}

function parseDeclaration(
  src: string,
  i0: number,
  limit: number,
  pending: { kdoc: { text: string; start: number } | null; annotations: KotlinAnnotation[]; annStart: number },
): KotlinRawDeclaration {
  let start = i0;
  if (pending.annStart >= 0) {
    start = Math.min(start, pending.annStart);
  }
  if (pending.kdoc) {
    start = Math.min(start, pending.kdoc.start);
  }
  const d = emptyDeclaration(start, i0);
  d.kdoc = pending.kdoc?.text ?? null;
  d.annotations = [...pending.annotations];

  let i = i0;
  for (;;) {
    i = skipSpaces(src, i, limit);
    if (src[i] === '@') {
      const a = parseAnnotation(src, i, limit);
      if (!a) {
        break;
      }
      d.annotations.push(a.ann);
      i = a.end;
      continue;
    }
    const w = readWord(src, i, limit);
    if (w && MODIFIERS.has(w.text)) {
      d.modifiers.push(w.text);
      i = w.end;
      continue;
    }
    break;
  }
  d.keywordIndex = i;
  const kw = readWord(src, i, limit);
  switch (kw?.text) {
    case 'class':
      parseClassLike(d, src, 'class', kw.end, limit);
      return d;
    case 'interface':
      parseClassLike(d, src, 'interface', kw.end, limit);
      return d;
    case 'object':
      parseClassLike(d, src, 'object', kw.end, limit);
      return d;
    case 'fun': {
      const next = readWord(src, skipSpaces(src, kw.end, limit), limit);
      if (next?.text === 'interface') {
        d.modifiers.push('fun');
        parseClassLike(d, src, 'interface', next.end, limit);
        return d;
      }
      parseFunction(d, src, kw.end, limit);
      return d;
    }
    case 'val':
    case 'var':
      parseProperty(d, src, kw.text as 'val' | 'var', kw.end, limit);
      return d;
    case 'constructor':
      parseConstructor(d, src, kw.end, limit);
      return d;
    case 'init': {
      const p = skipSpaces(src, kw.end, limit);
      d.keyword = 'init';
      if (src[p] === '{') {
        const close = matchingClose(src, p, '{', '}', limit);
        d.openBrace = p;
        d.closeBrace = close < 0 ? limit - 1 : close;
        d.end = d.closeBrace + 1;
        return d;
      }
      d.end = endOfStatement(src, kw.end, limit);
      return d;
    }
    case 'typealias':
      d.keyword = 'typealias';
      d.end = endOfStatement(src, kw.end, limit);
      return d;
    case 'package':
    case 'import': {
      const nl = src.indexOf('\n', i);
      d.end = nl < 0 || nl > limit ? limit : nl;
      return d;
    }
    default: {
      d.end = Math.max(endOfStatement(src, i, limit), i + 1);
      return d;
    }
  }
}

/** Declarations that start directly in `[from, to)` (not inside their bodies). */
export function scanKotlinDeclarations(src: string, from: number, to: number): KotlinRawDeclaration[] {
  const out: KotlinRawDeclaration[] = [];
  let pending: { kdoc: { text: string; start: number } | null; annotations: KotlinAnnotation[]; annStart: number } = {
    kdoc: null,
    annotations: [],
    annStart: -1,
  };
  let i = from;
  while (i < to) {
    const c = src[i]!;
    if (isSpace(c) || c === ';') {
      if (c === ';') {
        pending = { kdoc: null, annotations: [], annStart: -1 };
      }
      i++;
      continue;
    }
    if (src.startsWith('/**', i) && src[i + 3] !== '/') {
      const e = skipKotlinNoise(src, i, to);
      pending = { kdoc: { text: normalizeKdoc(src.slice(i, e)), start: i }, annotations: [], annStart: -1 };
      i = e;
      continue;
    }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      i = skipKotlinNoise(src, i, to);
      continue;
    }
    if (c === '@') {
      const a = parseAnnotation(src, i, to);
      if (a) {
        pending.annotations.push(a.ann);
        if (pending.annStart < 0) {
          pending.annStart = i;
        }
        i = a.end;
        continue;
      }
    }
    const decl = parseDeclaration(src, i, to, pending);
    out.push(decl);
    i = Math.max(decl.end, i + 1);
    pending = { kdoc: null, annotations: [], annStart: -1 };
  }
  return out;
}

/**
 * Start of the member region of a type body. Enum entries come first and end at the first
 * top-level `;`. An enum with no `;` has no members.
 */
export function membersRegion(src: string, d: KotlinRawDeclaration): { from: number; to: number } | null {
  if (d.openBrace < 0) {
    return null;
  }
  const from = d.openBrace + 1;
  const to = d.closeBrace;
  if (!d.modifiers.includes('enum')) {
    return { from, to };
  }
  let depth = 0;
  let k = from;
  while (k < to) {
    const n = skipKotlinNoise(src, k, to);
    if (n !== k) {
      k = n;
      continue;
    }
    const c = src[k];
    if (c === '(' || c === '{' || c === '[') {
      depth++;
    } else if (c === ')' || c === '}' || c === ']') {
      depth--;
    } else if (c === ';' && depth === 0) {
      return { from: k + 1, to };
    }
    k++;
  }
  return null;
}

export function visibilityOf(d: Pick<KotlinRawDeclaration, 'modifiers'>): 'public' | 'protected' | 'internal' | 'private' {
  for (const m of d.modifiers) {
    if (m === 'private' || m === 'protected' || m === 'internal' || m === 'public') {
      return m;
    }
  }
  return 'public';
}
