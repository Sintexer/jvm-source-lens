import { declaringSimpleName } from './javap-parse.js';
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
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  return { packageName, simpleToFqn, starPackages };
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
  if (ctx.packageName) {
    return `${ctx.packageName}.${simple}`;
  }
  if (ctx.starPackages.length > 0) {
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

function skipLexicalNoise(src: string, i: number): number {
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

function braceDepthAt(src: string, endExclusive: number): number {
  let depth = 0;
  let i = 0;
  while (i < endExclusive) {
    const ni = skipLexicalNoise(src, i);
    if (ni !== i) {
      i = ni;
      continue;
    }
    const ch = src[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    }
    i++;
  }
  return depth;
}

function findTopLevelTypeKeywordMatch(src: string, simpleName: string): { kind: ClassStructureKind; index: number } | null {
  const patterns: Array<{ kind: ClassStructureKind; re: RegExp }> = [
    { kind: 'class', re: new RegExp(`\\bclass\\s+${escapeRe(simpleName)}\\b`, 'g') },
    { kind: 'interface', re: new RegExp(`\\binterface\\s+${escapeRe(simpleName)}\\b`, 'g') },
    { kind: 'enum', re: new RegExp(`\\benum\\s+${escapeRe(simpleName)}\\b`, 'g') },
    { kind: 'record', re: new RegExp(`\\brecord\\s+${escapeRe(simpleName)}\\b`, 'g') },
    { kind: 'annotation', re: new RegExp(`@interface\\s+${escapeRe(simpleName)}\\b`, 'g') },
  ];

  let best: { kind: ClassStructureKind; index: number } | null = null;
  for (const { kind, re } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (braceDepthAt(src, m.index) !== 0) {
        continue;
      }
      if (!best || m.index < best.index) {
        best = { kind, index: m.index };
      }
    }
  }
  return best;
}

function findTypeBodyOpenBrace(src: string, declKeywordIdx: number): number {
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

function indexOfMatchingBrace(src: string, openIdx: number): number {
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

function stripLeadingModifiers(s: string): string {
  let cur = s.trimStart();
  for (;;) {
    const m = cur.match(
      /^(?:(?:public|private|protected|abstract|static|final|strictfp|default|synchronized|native|volatile|transient)\s+)/,
    );
    if (!m?.[1]) {
      break;
    }
    cur = cur.slice(m[1].length);
  }
  return cur.trimStart();
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

function parseExtendsImplements(headerSlice: string, kind: ClassStructureKind, ctx: ImportCtx): ParsedJavaTypeHeader {
  let superClass: string | null = null;
  const directInterfaces: string[] = [];

  if (kind === 'interface') {
    const ext = headerSlice.match(/\bextends\s+([\s\S]+?)(?=\s*\{|\s*$)/);
    if (ext?.[1]) {
      const parts = splitJavaParameters(ext[1].trim());
      for (const p of parts) {
        directInterfaces.push(resolveTypeRef(stripAnnotationsPrefix(p).split(/\s+/)[0] ?? p, ctx));
      }
    }
    const tp = headerSlice.match(/interface\s+\w+\s*<([^>]+)>/);
    const typeParameterNames: string[] = [];
    if (tp?.[1]) {
      for (const chunk of splitJavaParameters(tp[1])) {
        const name = chunk.split(/\s+/)[0]?.trim();
        if (name && /^[A-Z]\w*$/i.test(name)) {
          typeParameterNames.push(name);
        }
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

  const ext = headerSlice.match(/\bextends\s+([\w.<>,?\s]+)/);
  if (ext?.[1]) {
    superClass = resolveTypeRef(ext[1].trim(), ctx);
  } else if (kind === 'class') {
    superClass = 'java.lang.Object';
  }

  const impl = headerSlice.match(/\bimplements\s+([\s\S]+?)(?=\s*\{|\s*$)/);
  if (impl?.[1]) {
    const tail = impl[1];
    const parts = splitJavaParameters(tail.trim());
    for (const p of parts) {
      const rt = stripAnnotationsPrefix(p).split(/\s+/)[0] ?? p;
      directInterfaces.push(resolveTypeRef(rt, ctx));
    }
  }

  const tp = headerSlice.match(/<([^>]+)>/);
  const typeParameterNames: string[] = [];
  if (tp?.[1]) {
    for (const chunk of splitJavaParameters(tp[1])) {
      const name = chunk.split(/\s+/)[0]?.trim();
      if (name && /^[A-Z]\w*$/i.test(name)) {
        typeParameterNames.push(name);
      }
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

function looksLikeMethodSignatureBeforeBrace(prelude: string): boolean {
  const t = prelude.trim();
  return /\([^)]*\)\s*(?:throws\s+[\w\s.,]*)?\s*$/.test(t);
}

/**
 * Best-effort parse of a single compilation-unit `.java` for `classFqn`'s **top-level** type
 * matching {@link declaringSimpleName}.
 */
export function parseJavaTypeMetadata(source: string, classFqn: string): ParsedJavaTypeMetadata | null {
  const simple = declaringSimpleName(classFqn);
  const ctx = buildImportCtx(source);
  const hit = findTopLevelTypeKeywordMatch(source, simple);
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
  const fields: JavapFieldInfo[] = [];
  const methods: JavapMethodWithName[] = [];

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

    const parseMethodDecl = (declRaw: string): void => {
      const decl = declRaw.trim();
      const inner = stripMethodGenericsPrefix(stripLeadingModifiers(decl));
      const openParen = inner.indexOf('(');
      if (openParen <= 0) {
        return;
      }
      const head = inner.slice(0, openParen).trim();
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
    };

    if (
      braceMember >= 0 &&
      (semiMember < 0 || braceMember < semiMember)
    ) {
      const prelude = body.slice(stmtStart, braceMember);
      if (looksLikeMethodSignatureBeforeBrace(prelude)) {
        parseMethodDecl(prelude);
      }
      i = consumeBalancedBraces(body, braceMember);
      continue;
    }

    if (semiMember >= 0) {
      const decl = body.slice(stmtStart, semiMember).trim();
      if (/\([^)]*\)/.test(decl)) {
        parseMethodDecl(decl);
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
