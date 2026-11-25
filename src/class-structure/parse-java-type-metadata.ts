import { locateTypeDeclaration } from './locate-type-declaration.js';
import { declaringSimpleName } from './javap-parse.js';
import { stripLeadingModifiers } from './strip-leading-modifiers.js';
import type {
  ClassStructureKind,
  JavapFieldInfo,
  JavapMethodWithName,
  JavapParameter,
} from './types.js';

/** JVM descriptors start with '('; synthetic source-derived keys never do. */
export const JAVA_SOURCE_SYNTHETIC_DESC_PREFIX = '#SRC:';

export function isSyntheticJvmDescriptor(descriptor: string): boolean {
  return descriptor.startsWith(JAVA_SOURCE_SYNTHETIC_DESC_PREFIX);
}

export function syntheticJvmDescriptor(methodJvmName: string, parameterTypeDisplays: string[]): string {
  return `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}${methodJvmName}(${parameterTypeDisplays.join(',')})`;
}

type ImportCtx = {
  packageName: string | null;
  simpleToFqn: Map<string, string>;
  starPackages: string[];
  /** Member types of this compilation unit: simple name → `Outer$Inner`. */
  nestedTypes: Map<string, string>;
};

/** Frequent `java.lang` simple names. Other unknown names never get `java.lang` by guess. */
const JAVA_LANG_TYPES: ReadonlySet<string> = new Set([
  'Appendable', 'ArithmeticException', 'ArrayIndexOutOfBoundsException', 'ArrayStoreException',
  'AssertionError', 'AutoCloseable', 'Boolean', 'Byte', 'CharSequence', 'Character', 'Class',
  'ClassCastException', 'ClassLoader', 'ClassNotFoundException', 'CloneNotSupportedException',
  'Cloneable', 'Comparable', 'Deprecated', 'Double', 'Enum', 'Error', 'Exception',
  'ExceptionInInitializerError', 'Float', 'FunctionalInterface', 'IllegalAccessException',
  'IllegalArgumentException', 'IllegalMonitorStateException', 'IllegalStateException',
  'IndexOutOfBoundsException', 'InstantiationException', 'Integer', 'InterruptedException',
  'Iterable', 'LinkageError', 'Long', 'Math', 'NegativeArraySizeException', 'NoSuchFieldException',
  'NoSuchMethodException', 'NullPointerException', 'Number', 'NumberFormatException', 'Object',
  'OutOfMemoryError', 'Override', 'Process', 'Readable', 'Record', 'ReflectiveOperationException',
  'Runnable', 'Runtime', 'RuntimeException', 'SafeVarargs', 'SecurityException', 'Short',
  'StackOverflowError', 'StackTraceElement', 'StrictMath', 'String', 'StringBuffer', 'StringBuilder',
  'StringIndexOutOfBoundsException', 'SuppressWarnings', 'System', 'Thread', 'ThreadLocal',
  'Throwable', 'TypeNotPresentException', 'UnsupportedOperationException', 'VirtualMachineError',
  'Void',
]);

function buildImportCtx(source: string): ImportCtx {
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? null;
  const simpleToFqn = new Map<string, string>();
  const starPackages: string[] = [];

  const importRE = /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = importRE.exec(source)) !== null) {
    const spec = m[1]!;
    if (spec.endsWith('.*')) {
      starPackages.push(spec.slice(0, -2));
      continue;
    }
    const dot = spec.lastIndexOf('.');
    const simple = dot >= 0 ? spec.slice(dot + 1) : spec;
    simpleToFqn.set(simple, spec);
  }

  return { packageName, simpleToFqn, starPackages, nestedTypes: collectNestedTypeBinaryNames(source) };
}

function stripGenerics(typeRaw: string): string {
  let s = typeRaw.trim();
  const angle = s.indexOf('<');
  if (angle >= 0) {
    s = s.slice(0, angle).trim();
  }
  return s.replace(/\[\s*\]/g, '[]').trim();
}

function resolveTypeRef(raw: string, ctx: ImportCtx): string {
  const base = stripGenerics(raw.split(/\s+/)[0] ?? raw);
  if (!base) {
    return raw.trim();
  }
  if (base.includes('.')) {
    const head = base.slice(0, base.indexOf('.'));
    const tail = base.slice(base.indexOf('.') + 1);
    if (!tail.includes('.')) {
      const hr = resolveSimple(head, ctx);
      return `${hr}.${tail}`;
    }
    return base;
  }
  return resolveSimple(base, ctx);
}

function resolveSimple(simple: string, ctx: ImportCtx): string {
  const hit = ctx.simpleToFqn.get(simple);
  if (hit) {
    return hit;
  }
  const nested = ctx.nestedTypes.get(simple);
  if (nested) {
    return ctx.packageName ? `${ctx.packageName}.${nested}` : nested;
  }
  if (JAVA_LANG_TYPES.has(simple)) {
    return `java.lang.${simple}`;
  }
  if (ctx.starPackages.length === 0) {
    return ctx.packageName ? `${ctx.packageName}.${simple}` : simple;
  }
  if (ctx.starPackages.length === 1) {
    return `${ctx.starPackages[0]}.${simple}`;
  }
  return simple;
}

function resolveThrowsList(raw: string | null, ctx: ImportCtx): string[] {
  if (!raw) {
    return [];
  }
  const parts = splitJavaParameters(raw);
  return parts.map((p) => resolveTypeRef(stripAnnotationsPrefix(p).split(/\s+/)[0] ?? p, ctx)).filter(Boolean);
}

/** Strip leading `@Foo(...)` / `@Foo` before a type fragment (javap-parse parity). */
function stripAnnotationsPrefix(segment: string): string {
  let s = segment.trim();
  for (;;) {
    const idx = s.search(/@\s*[\w$.]+/);
    if (idx !== 0) {
      break;
    }
    let depth = 0;
    let i = 0;
    let started = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '(') {
        depth++;
        started = true;
      } else if (c === ')') {
        depth--;
        if (started && depth === 0) {
          i++;
          break;
        }
      } else if (!started && (c === ' ' || c === '\t')) {
        break;
      }
    }
    if (!started) {
      s = s.slice(i).trimStart();
      continue;
    }
    s = s.slice(i).trimStart();
  }
  return s.replace(/^final\s+/, '').trim();
}

/** Strips any mix of leading `@Annotation(...)` and modifiers (`@A public @B static final ...`). */
function stripLeadingAnnotationsAndModifiers(s: string): string {
  let cur = s.trimStart();
  for (;;) {
    const next = stripLeadingModifiers(stripAnnotationsPrefix(cur));
    if (next === cur) {
      return cur;
    }
    cur = next;
  }
}

/** Removes `@Foo` / `@Foo(...)` occurring anywhere in a type fragment (e.g. `@Nullable String`). */
function stripInlineAnnotations(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '@' && /[\w$]/.test(s[i + 1] ?? '')) {
      i++;
      while (i < s.length && /[\w$.]/.test(s[i]!)) {
        i++;
      }
      let j = i;
      while (j < s.length && /\s/.test(s[j]!)) {
        j++;
      }
      if (s[j] === '(') {
        let depth = 0;
        for (; j < s.length; j++) {
          if (s[j] === '(') {
            depth++;
          } else if (s[j] === ')' && --depth === 0) {
            j++;
            break;
          }
        }
        i = j;
      }
      continue;
    }
    out += s[i];
    i++;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function skipLineComment(src: string, i: number): number {
  let j = i + 2;
  while (j < src.length && src[j] !== '\n') {
    j++;
  }
  return j;
}

function skipBlockComment(src: string, i: number): number {
  let j = i + 2;
  while (j + 1 < src.length && !(src[j] === '*' && src[j + 1] === '/')) {
    j++;
  }
  return j + 2 < src.length ? j + 2 : src.length;
}

function skipStringLiteral(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) {
      return j + 1;
    }
    j++;
  }
  return src.length;
}

function skipTextBlock(src: string, i: number): number {
  let j = i + 3;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src.startsWith('"""', j)) {
      return j + 3;
    }
    j++;
  }
  return src.length;
}

export function skipLexicalNoise(src: string, i: number): number {
  if (src.startsWith('"""', i)) {
    return skipTextBlock(src, i);
  }
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') {
    return skipLineComment(src, i);
  }
  if (c === '/' && src[i + 1] === '*') {
    return skipBlockComment(src, i);
  }
  if (c === '"' || c === '\'') {
    return skipStringLiteral(src, i);
  }
  return i;
}

const TYPE_KEYWORDS: ReadonlyArray<{ keyword: string; kind: ClassStructureKind }> = [
  { keyword: '@interface', kind: 'annotation' },
  { keyword: 'class', kind: 'class' },
  { keyword: 'interface', kind: 'interface' },
  { keyword: 'enum', kind: 'enum' },
  { keyword: 'record', kind: 'record' },
];

const IDENT_CHAR = /[\w$]/;

/** Type declaration keyword plus name that starts exactly at code position `i`, else null. */
export function typeKeywordAt(src: string, i: number): { kind: ClassStructureKind; name: string; end: number } | null {
  const prev = i > 0 ? src[i - 1]! : '';
  if (IDENT_CHAR.test(prev) || prev === '.' || prev === '@') {
    return null;
  }
  for (const { keyword, kind } of TYPE_KEYWORDS) {
    if (!src.startsWith(keyword, i)) {
      continue;
    }
    const m = /^\s+([A-Za-z_$][\w$]*)/.exec(src.slice(i + keyword.length, i + keyword.length + 256));
    if (!m) {
      return null;
    }
    return { kind, name: m[1]!, end: i + keyword.length + m[0].length };
  }
  return null;
}

/**
 * First declaration of type `simpleName` in `[from, toExclusive)` at brace depth 0 relative to `from`.
 * Comments, strings and text blocks are skipped. `from` must be a code position.
 */
function scanTypeKeyword(
  src: string,
  simpleName: string,
  from: number,
  toExclusive: number,
): { kind: ClassStructureKind; index: number } | null {
  let depth = 0;
  let i = from;
  while (i < toExclusive) {
    const ni = skipLexicalNoise(src, i);
    if (ni !== i) {
      i = ni;
      continue;
    }
    const c = src[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth < 0) {
        return null;
      }
    } else if (depth === 0) {
      const hit = typeKeywordAt(src, i);
      if (hit) {
        if (hit.name === simpleName) {
          return { kind: hit.kind, index: i };
        }
        i = hit.end;
        continue;
      }
    }
    i++;
  }
  return null;
}

export function findTopLevelTypeKeywordMatch(src: string, simpleName: string): { kind: ClassStructureKind; index: number } | null {
  return scanTypeKeyword(src, simpleName, 0, src.length);
}

/**
 * Type declaration in `[from, toExclusive)` that is a direct child of the region (brace depth 0
 * relative to `from`). Skips comments, strings, local classes and deeper same-name types.
 */
export function findTypeKeywordMatchInRange(
  src: string,
  simpleName: string,
  from: number,
  toExclusive: number,
): { kind: ClassStructureKind; index: number } | null {
  return scanTypeKeyword(src, simpleName, from, toExclusive);
}

/**
 * Member types declared in type bodies of this compilation unit (local classes excluded):
 * simple name → binary path below the package (`Outer$Inner`). First declaration wins.
 */
function collectNestedTypeBinaryNames(src: string): Map<string, string> {
  const out = new Map<string, string>();
  /** Per open brace: type chain for a type body, `null` for any other block. */
  const stack: Array<string | null> = [];
  let pending: { chain: string; open: number } | null = null;
  let i = 0;
  while (i < src.length) {
    const ni = skipLexicalNoise(src, i);
    if (ni !== i) {
      i = ni;
      continue;
    }
    const c = src[i];
    if (c === '{') {
      if (pending && pending.open === i) {
        stack.push(pending.chain);
        pending = null;
      } else {
        stack.push(null);
      }
    } else if (c === '}') {
      stack.pop();
    } else {
      const top = stack.length === 0 ? '' : stack[stack.length - 1]!;
      if (top !== null) {
        const hit = typeKeywordAt(src, i);
        if (hit) {
          const chain = top ? `${top}$${hit.name}` : hit.name;
          const open = findTypeBodyOpenBrace(src, hit.end);
          if (open >= 0) {
            pending = { chain, open };
            if (top && !out.has(hit.name)) {
              out.set(hit.name, chain);
            }
          }
          i = hit.end;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

export function findTypeBodyOpenBrace(src: string, declKeywordIdx: number): number {
  let i = declKeywordIdx;
  let angle = 0;
  let paren = 0;
  while (i < src.length) {
    const ni = skipLexicalNoise(src, i);
    if (ni !== i) {
      i = ni;
      continue;
    }
    const c = src[i];
    if (c === '<') {
      angle++;
    } else if (c === '>') {
      angle--;
    } else if (c === '(') {
      paren++;
    } else if (c === ')') {
      paren--;
    } else if (c === '{' && angle === 0 && paren === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

export function indexOfMatchingBrace(src: string, openIdx: number): number {
  if (src[openIdx] !== '{') {
    return -1;
  }
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length) {
    const ni = skipLexicalNoise(src, i);
    if (ni !== i) {
      i = ni;
      continue;
    }
    const c = src[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function stripMethodGenericsPrefix(s: string): string {
  let cur = s.trimStart();
  while (cur.startsWith('<')) {
    let depth = 0;
    let i = 0;
    for (; i < cur.length; i++) {
      const c = cur[i];
      if (c === '<') {
        depth++;
      } else if (c === '>') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) {
      return cur;
    }
    cur = cur.slice(i).trimStart();
  }
  return cur;
}

function extractParenContent(line: string): string | null {
  const open = line.indexOf('(');
  if (open < 0) {
    return null;
  }
  let depthParen = 0;
  let depthAngle = 0;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    } else if (depthAngle === 0 && c === '(') {
      depthParen++;
    } else if (depthAngle === 0 && c === ')') {
      depthParen--;
      if (depthParen === 0) {
        return line.slice(open + 1, i);
      }
    }
  }
  return null;
}

function splitJavaParameters(paramsStr: string): string[] {
  const out: string[] = [];
  let depthAngle = 0;
  let cur = '';
  for (let i = 0; i < paramsStr.length; i++) {
    const c = paramsStr[i];
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    }
    if (c === ',' && depthAngle === 0) {
      const t = cur.trim();
      if (t) {
        out.push(t);
      }
      cur = '';
      continue;
    }
    cur += c;
  }
  const last = cur.trim();
  if (last) {
    out.push(last);
  }
  return out;
}

function parseOneParamSegment(segment: string): { typeDisplay: string; name: string | null } {
  const s = stripAnnotationsPrefix(segment);
  const varargs = s.endsWith('...');
  const core = varargs ? s.replace(/\.\.\.\s*$/, '').trim() : s;
  const tokens = core.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const name = tokens[tokens.length - 1]!;
    const typeDisplay = tokens.slice(0, -1).join(' ') + (varargs ? '...' : '');
    return { typeDisplay, name };
  }
  return { typeDisplay: core + (varargs ? '...' : ''), name: null };
}

function parseThrowsTail(line: string): string | null {
  const idx = line.search(/\bthrows\b/);
  if (idx < 0) {
    return null;
  }
  let tail = line.slice(idx + 'throws'.length).trim();
  const brace = tail.indexOf('{');
  const semi = tail.indexOf(';');
  let cut = tail.length;
  if (brace >= 0) {
    cut = Math.min(cut, brace);
  }
  if (semi >= 0) {
    cut = Math.min(cut, semi);
  }
  tail = tail.slice(0, cut).trim();
  return tail.length > 0 ? tail : null;
}

export type ParsedJavaTypeHeader = {
  kind: ClassStructureKind;
  superClass: string | null;
  directInterfaces: string[];
  typeParameterNames: string[];
};

export type ParsedJavaTypeMetadata = {
  header: ParsedJavaTypeHeader;
  fields: JavapFieldInfo[];
  methods: JavapMethodWithName[];
};

/** Absolute `[start, end)` offsets in the compilation unit for one method/constructor. */
export type MethodSourceSpan = {
  jvmMethodName: string;
  start: number;
  end: number;
};

export type ParseJavaTypeMetadataOptions = {
  /** When set, records method/constructor source spans while parsing. */
  methodSpans?: MethodSourceSpan[];
};

function findMatchingAngleClose(s: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '<') {
      depth++;
    } else if (c === '>') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Splits off the type's own `<T, U extends V>` clause (right after the type name) from the
 * rest of the header. Without this, a bounded type parameter like `<V extends Comparable<K>>`
 * would leak its own `extends`/`implements` keywords into the superclass/interface search below,
 * truncating or replacing the real `extends Foo` / `implements Bar` clause.
 */
function splitOwnTypeParamsAndRest(headerSlice: string, kind: ClassStructureKind): { typeParameterNames: string[]; rest: string } {
  const m = headerSlice.match(/^(?:class|interface|enum|record)\s+[\w$]+/);
  if (!m) {
    return { typeParameterNames: [], rest: headerSlice };
  }
  let i = m[0].length;
  while (i < headerSlice.length && /\s/.test(headerSlice[i]!)) {
    i++;
  }
  if (headerSlice[i] !== '<') {
    return { typeParameterNames: [], rest: headerSlice };
  }
  const closeIdx = findMatchingAngleClose(headerSlice, i);
  if (closeIdx < 0) {
    return { typeParameterNames: [], rest: headerSlice };
  }
  const inner = headerSlice.slice(i + 1, closeIdx);
  const typeParameterNames: string[] = [];
  for (const chunk of splitJavaParameters(inner)) {
    const name = chunk.split(/\s+/)[0]?.trim();
    if (name && /^[A-Z]\w*$/i.test(name)) {
      typeParameterNames.push(name);
    }
  }
  const rest = headerSlice.slice(0, i) + headerSlice.slice(closeIdx + 1);
  return { typeParameterNames, rest };
}

function parseExtendsImplements(headerSlice: string, kind: ClassStructureKind, ctx: ImportCtx): ParsedJavaTypeHeader {
  let superClass: string | null = null;
  const directInterfaces: string[] = [];
  const { typeParameterNames, rest } = splitOwnTypeParamsAndRest(headerSlice, kind);

  if (kind === 'interface') {
    const ext = rest.match(/\bextends\s+([\s\S]+?)(?=\s*\{|\s*$)/);
    if (ext?.[1]) {
      const parts = splitJavaParameters(ext[1].trim());
      for (const p of parts) {
        directInterfaces.push(resolveTypeRef(stripAnnotationsPrefix(p).split(/\s+/)[0] ?? p, ctx));
      }
    }
    return { kind, superClass: null, directInterfaces, typeParameterNames };
  }

  if (kind === 'enum') {
    return { kind, superClass: 'java.lang.Enum', directInterfaces: [], typeParameterNames: [] };
  }

  if (kind === 'annotation') {
    return { kind, superClass: null, directInterfaces: [], typeParameterNames: [] };
  }

  const ext = rest.match(/\bextends\s+([\w.<>,?\s]+)/);
  if (ext?.[1]) {
    superClass = resolveTypeRef(ext[1].trim(), ctx);
  } else if (kind === 'class') {
    superClass = 'java.lang.Object';
  }

  const impl = rest.match(/\bimplements\s+([\s\S]+?)(?=\s*\{|\s*$)/);
  if (impl?.[1]) {
    const tail = impl[1];
    const parts = splitJavaParameters(tail.trim());
    for (const p of parts) {
      const rt = stripAnnotationsPrefix(p).split(/\s+/)[0] ?? p;
      directInterfaces.push(resolveTypeRef(rt, ctx));
    }
  }

  return { kind, superClass, directInterfaces, typeParameterNames };
}

function visibilityFromMods(modFragment: string): 'public' | 'protected' | 'package' | 'private' {
  if (/\bpublic\b/.test(modFragment)) {
    return 'public';
  }
  if (/\bprotected\b/.test(modFragment)) {
    return 'protected';
  }
  if (/\bprivate\b/.test(modFragment)) {
    return 'private';
  }
  return 'package';
}

function parseHeaderSlice(headerSlice: string, kind: ClassStructureKind, ctx: ImportCtx): ParsedJavaTypeHeader {
  const base = parseExtendsImplements(headerSlice, kind, ctx);
  return base;
}

function consumeBalancedBraces(src: string, openIdx: number): number {
  const close = indexOfMatchingBrace(src, openIdx);
  return close >= 0 ? close + 1 : src.length;
}

function indexOfSemicolonAtDepthZero(body: string, start: number): number {
  let depthBrace = 0;
  let depthParen = 0;
  let depthAngle = 0;
  let j = start;
  while (j < body.length) {
    const nj = skipLexicalNoise(body, j);
    if (nj !== j) {
      j = nj;
      continue;
    }
    const c = body[j];
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    } else if (depthAngle === 0 && c === '(') {
      depthParen++;
    } else if (depthAngle === 0 && c === ')') {
      depthParen--;
    } else if (depthAngle === 0 && depthParen === 0 && c === '{') {
      depthBrace++;
    } else if (depthAngle === 0 && depthParen === 0 && c === '}') {
      depthBrace--;
    } else if (depthAngle === 0 && depthParen === 0 && depthBrace === 0 && c === ';') {
      return j;
    }
    j++;
  }
  return -1;
}

function indexOfOpeningBraceAtDepthZero(body: string, start: number): number {
  let depthParen = 0;
  let depthAngle = 0;
  let j = start;
  while (j < body.length) {
    const nj = skipLexicalNoise(body, j);
    if (nj !== j) {
      j = nj;
      continue;
    }
    const c = body[j];
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    } else if (depthAngle === 0 && c === '(') {
      depthParen++;
    } else if (depthAngle === 0 && c === ')') {
      depthParen--;
    } else if (depthAngle === 0 && depthParen === 0 && c === '{') {
      return j;
    }
    j++;
  }
  return -1;
}

/**
 * First `=` in `[from, toExclusive)` outside parentheses and lexical noise that is an assignment
 * (not `==`, `!=`, `<=`, `>=`). Annotation arguments like `@A(v = 1)` are inside parentheses.
 */
function indexOfTopLevelAssign(body: string, from: number, toExclusive: number): number {
  let depthParen = 0;
  let j = from;
  while (j < toExclusive) {
    const nj = skipLexicalNoise(body, j);
    if (nj !== j) {
      j = nj;
      continue;
    }
    const c = body[j];
    if (c === '(') {
      depthParen++;
    } else if (c === ')') {
      depthParen--;
    } else if (c === '=' && depthParen === 0) {
      const prev = body[j - 1] ?? '';
      const next = body[j + 1] ?? '';
      if (next !== '=' && !'=!<>'.includes(prev)) {
        return j;
      }
    }
    j++;
  }
  return -1;
}

/** `;` at paren and brace depth 0. No angle tracking: initializers may contain `a < b`. */
function indexOfStatementEnd(body: string, from: number): number {
  let depth = 0;
  let j = from;
  while (j < body.length) {
    const nj = skipLexicalNoise(body, j);
    if (nj !== j) {
      j = nj;
      continue;
    }
    const c = body[j];
    if (c === '(' || c === '{' || c === '[') {
      depth++;
    } else if (c === ')' || c === '}' || c === ']') {
      depth--;
    } else if (c === ';' && depth === 0) {
      return j;
    }
    j++;
  }
  return -1;
}

/** Field `type name = init`. The initializer is replaced by `…` when it has a body (lambda, array, anonymous class). */
function fieldWithInitializer(declaratorRaw: string, initializerRaw: string): JavapFieldInfo | null {
  const declarator = stripLeadingAnnotationsAndModifiers(declaratorRaw).replace(/\s+/g, ' ').trim();
  const tokens = declarator.split(' ').filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }
  const name = tokens[tokens.length - 1]!.replace(/\[\s*\]/g, '');
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return null;
  }
  const initializer = initializerRaw.replace(/\s+/g, ' ').trim();
  const shownInit = initializer.includes('{') ? '…' : initializer;
  return {
    declarationLine: `${declarator} = ${shownInit}`,
    visibility: visibilityFromMods(declaratorRaw),
    jvmDescriptor: `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}field:${name}`,
    flagsLine: null,
    enumConstant: false,
  };
}

function looksLikeMethodSignatureBeforeBrace(prelude: string): boolean {
  const t = prelude.trim();
  return /\([^)]*\)\s*(?:throws\s+[\w\s.,]*)?\s*$/.test(t);
}

export function extendSpanWithLeadingJavadoc(source: string, memberStart: number): number {
  let i = memberStart;
  while (i > 0 && /\s/.test(source[i - 1]!)) {
    i--;
  }
  if (i < 2 || source[i - 1] !== '/' || source[i - 2] !== '*') {
    return memberStart;
  }
  let j = i - 2;
  while (j > 0) {
    const k = source.lastIndexOf('/**', j);
    if (k < 0) {
      break;
    }
    let lineStart = k;
    while (lineStart > 0 && source[lineStart - 1] !== '\n') {
      lineStart--;
    }
    let onlyWs = true;
    for (let t = lineStart; t < k; t++) {
      if (!/\s/.test(source[t]!)) {
        onlyWs = false;
        break;
      }
    }
    if (!onlyWs) {
      break;
    }
    return lineStart;
  }
  return memberStart;
}

/** Simple names from a binary name: `com.foo.Outer$Inner` → `['Outer', 'Inner']`. */
function binaryTypeNames(classFqn: string): string[] {
  const dot = classFqn.lastIndexOf('.');
  const simple = dot < 0 ? classFqn : classFqn.slice(dot + 1);
  return simple.split('$');
}

/**
 * Nested names are located inside the enclosing declaration. When that walk misses
 * (an exact `Outer$Inner.java` that declares only the inner type), use the top-level type.
 */
function resolveTypeKeyword(
  source: string,
  classFqn: string,
): { kind: ClassStructureKind; index: number } | null {
  const names = binaryTypeNames(classFqn);
  const innermost = names[names.length - 1] ?? '';
  if (innermost.length === 0 || names.some((name) => name.length === 0)) {
    return null;
  }
  if (names.length > 1) {
    const span = locateTypeDeclaration(source, names);
    if (span) {
      return findTypeKeywordMatchInRange(source, innermost, span.start, span.openBrace + 1);
    }
  }
  return findTopLevelTypeKeywordMatch(source, innermost);
}

/**
 * Best-effort parse of a compilation unit for `classFqn`, including a nested binary name
 * (`Outer$Inner`) inside the enclosing file.
 */
export function parseJavaTypeMetadata(
  source: string,
  classFqn: string,
  options?: ParseJavaTypeMetadataOptions,
): ParsedJavaTypeMetadata | null {
  const simple = declaringSimpleName(classFqn);
  const ctx = buildImportCtx(source);
  const hit = resolveTypeKeyword(source, classFqn);
  if (!hit) {
    return null;
  }

  const openBrace = findTypeBodyOpenBrace(source, hit.index);
  if (openBrace < 0) {
    return null;
  }

  const headerSlice = source.slice(hit.index, openBrace);
  const header = parseHeaderSlice(headerSlice, hit.kind, ctx);

  const closeBrace = indexOfMatchingBrace(source, openBrace);
  if (closeBrace < 0) {
    return null;
  }

  const body = source.slice(openBrace + 1, closeBrace);
  const bodyBase = openBrace + 1;
  const fields: JavapFieldInfo[] = [];
  const methods: JavapMethodWithName[] = [];
  const methodSpans = options?.methodSpans;

  if (hit.kind === 'enum') {
    const head = body.split(';')[0] ?? body;
    for (const part of head.split(',')) {
      const frag = part.trim();
      const name = frag.split(/[\s(]/)[0] ?? '';
      if (name && /^[A-Z_]\w*$/i.test(name)) {
        fields.push({
          declarationLine: frag.replace(/\s+/g, ' ').trim(),
          visibility: 'public',
          jvmDescriptor: `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}enum:${name}`,
          flagsLine: null,
          enumConstant: true,
        });
      }
    }
    return { header, fields, methods };
  }

  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i]!)) {
      i++;
    }
    if (i >= body.length) {
      break;
    }

    const ni = skipLexicalNoise(body, i);
    if (ni !== i) {
      i = ni;
      continue;
    }

    const staticInit = body.slice(i).match(/^\s*static\s*\{/);
    if (staticInit) {
      const ob = body.indexOf('{', i);
      if (ob >= 0) {
        i = consumeBalancedBraces(body, ob);
      } else {
        i++;
      }
      continue;
    }

    const nested = body.slice(i).match(/^\s*(?:@\w[^\s]*\s*)*\b(?:public\s+|protected\s+|private\s+)?(?:abstract\s+|final\s+|static\s+|sealed\s+|non-sealed\s+)*(class|interface|enum|record)\s+\w+/);
    const nestedAnn = body.slice(i).match(/^\s*(?:@\w[^\s]*\s*)*@interface\s+\w+/);
    if (nested || nestedAnn) {
      const ob = body.indexOf('{', i);
      if (ob >= 0) {
        i = consumeBalancedBraces(body, ob);
      } else {
        i++;
      }
      continue;
    }

    const stmtStart = i;
    const semiMember = indexOfSemicolonAtDepthZero(body, i);
    const braceMember = indexOfOpeningBraceAtDepthZero(body, i);

    const memberEnd = Math.min(
      semiMember >= 0 ? semiMember : body.length,
      braceMember >= 0 ? braceMember : body.length,
    );
    const assign = indexOfTopLevelAssign(body, stmtStart, memberEnd);
    if (assign >= 0) {
      const end = indexOfStatementEnd(body, assign + 1);
      const stop = end >= 0 ? end : body.length;
      const declarator = body.slice(stmtStart, assign);
      const field = fieldWithInitializer(declarator, body.slice(assign + 1, stop));
      if (field) {
        fields.push(field);
      }
      i = stop + 1;
      continue;
    }

    const recordMethodSpan = (jvmMethodName: string, relStart: number, relEnd: number): void => {
      if (!methodSpans) {
        return;
      }
      const absStart = extendSpanWithLeadingJavadoc(source, bodyBase + relStart);
      methodSpans.push({ jvmMethodName, start: absStart, end: bodyBase + relEnd });
    };

    const parseMethodDecl = (declRaw: string, relStart: number, relEnd: number): void => {
      const decl = declRaw.trim();
      const inner = stripAnnotationsPrefix(stripMethodGenericsPrefix(stripLeadingAnnotationsAndModifiers(decl)));
      const openParen = inner.indexOf('(');
      if (openParen <= 0) {
        return;
      }
      const head = stripInlineAnnotations(inner.slice(0, openParen));
      const paramsInner = extractParenContent(inner);
      const throwsRaw = parseThrowsTail(decl);

      let jvmMethodName: string;
      let returnTypeDisplay: string | null;

      const simpleTok = head.split(/\s+/).filter(Boolean);
      const lastTok = simpleTok[simpleTok.length - 1];
      if (lastTok === simple && simpleTok.length >= 1) {
        jvmMethodName = '<init>';
        returnTypeDisplay = '';
      } else if (hit.kind === 'interface' && !/\b(static|default)\b/.test(decl)) {
        jvmMethodName = lastTok ?? '';
        returnTypeDisplay = simpleTok.length >= 2 ? simpleTok.slice(0, -1).join(' ') : '';
      } else {
        jvmMethodName = lastTok ?? '';
        returnTypeDisplay = simpleTok.length >= 2 ? simpleTok.slice(0, -1).join(' ') : '';
      }

      const paramsParsed =
        paramsInner && paramsInner.trim().length > 0 ? splitJavaParameters(paramsInner) : [];
      const parameters: JavapParameter[] = paramsParsed.map((seg) => {
        const po = parseOneParamSegment(seg);
        return { name: po.name, typeDisplay: po.typeDisplay };
      });
      const thrownExceptions = resolveThrowsList(throwsRaw, ctx);

      const syntheticDesc = syntheticJvmDescriptor(jvmMethodName, parameters.map((p) => p.typeDisplay));

      methods.push({
        jvmMethodName,
        declarationLine: decl.replace(/\s+/g, ' ').trim(),
        visibility: visibilityFromMods(decl),
        jvmDescriptor: syntheticDesc,
        genericSignature: null,
        returnTypeDisplay,
        parameters,
        thrownExceptions,
        flagsLine: null,
      });
      recordMethodSpan(jvmMethodName, relStart, relEnd);
    };

    if (
      braceMember >= 0 &&
      (semiMember < 0 || braceMember < semiMember)
    ) {
      const prelude = body.slice(stmtStart, braceMember);
      if (looksLikeMethodSignatureBeforeBrace(prelude)) {
        const relEnd = consumeBalancedBraces(body, braceMember);
        parseMethodDecl(prelude, stmtStart, relEnd);
      }
      i = consumeBalancedBraces(body, braceMember);
      continue;
    }

    if (semiMember >= 0) {
      const decl = body.slice(stmtStart, semiMember).trim();
      if (/\([^)]*\)/.test(decl)) {
        parseMethodDecl(decl, stmtStart, semiMember + 1);
      } else if (/\w+\s*$/.test(stripLeadingModifiers(decl))) {
        const stripped = stripAnnotationsPrefix(stripLeadingModifiers(decl)).replace(/;$/, '').trim();
        const tokens = stripped.split(/\s+/).filter(Boolean);
        if (tokens.length >= 2) {
          const name = tokens[tokens.length - 1]!;
          fields.push({
            declarationLine: stripped,
            visibility: visibilityFromMods(decl),
            jvmDescriptor: `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}field:${name}`,
            flagsLine: null,
            enumConstant: false,
          });
        }
      }
      i = semiMember + 1;
      continue;
    }

    i++;
  }

  return { header, fields, methods };
}

/** Collects method/constructor source spans for `classFqn` in a `.java` compilation unit. */
export function collectMethodSourceSpans(source: string, classFqn: string): MethodSourceSpan[] | null {
  const spans: MethodSourceSpan[] = [];
  const meta = parseJavaTypeMetadata(source, classFqn, { methodSpans: spans });
  if (!meta) {
    return null;
  }
  return spans;
}
