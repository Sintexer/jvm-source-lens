import { declaringSimpleName } from './javap-parse.js';

export type JavaMethodSkeleton = {
  name: string;
  javadoc: string | null;
  paramCount: number;
};

export type JavaClassSkeleton = {
  typeJavadoc: string | null;
  methods: JavaMethodSkeleton[];
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeJavadoc(raw: string): string {
  return raw.replace(/^\s*\*\s?/gm, '').replace(/^\s+|\s+$/g, '');
}

function countParametersInParens(inner: string): number {
  const t = inner.trim();
  if (t.length === 0) {
    return 0;
  }
  let depthAngle = 0;
  let depthParen = 0;
  let commas = 0;
  for (const c of t) {
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    } else if (c === '(') {
      depthParen++;
    } else if (c === ')') {
      depthParen--;
    } else if (c === ',' && depthAngle === 0 && depthParen === 0) {
      commas++;
    }
  }
  return commas + 1;
}

function findMatchingParen(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function skipWhitespaceAndAnnotations(fragment: string): string {
  let i = 0;
  for (;;) {
    while (i < fragment.length && /\s/.test(fragment[i]!)) {
      i++;
    }
    if (fragment[i] !== '@') {
      break;
    }
    const rest = fragment.slice(i);
    const ann = rest.match(/^@\s*[\w$.]+(?:\([^)]*\))?/);
    if (!ann) {
      break;
    }
    i += ann[0].length;
  }
  return fragment.slice(i);
}

function parseMethodAfterJavadoc(fragment: string, classSimpleName: string): JavaMethodSkeleton | null {
  const stmt = skipWhitespaceAndAnnotations(fragment);
  if (stmt.length === 0) {
    return null;
  }

  const ctorRe = new RegExp(`\\b${escapeRe(classSimpleName)}\\s*\\(`);
  const ctorMatch = ctorRe.exec(stmt);
  if (ctorMatch && ctorMatch.index !== undefined) {
    const open = stmt.indexOf('(', ctorMatch.index);
    const paren = stmt.indexOf('(', open);
    if (paren < 0) {
      return null;
    }
    const close = findMatchingParen(stmt, paren);
    if (close < 0) {
      return null;
    }
    const inner = stmt.slice(paren + 1, close);
    return { name: classSimpleName, paramCount: countParametersInParens(inner), javadoc: null };
  }

  const open = stmt.indexOf('(');
  if (open < 0) {
    return null;
  }
  const head = stmt.slice(0, open);
  const headTokens = head.trim().split(/\s+/).filter(Boolean);
  const name = headTokens[headTokens.length - 1];
  if (!name || !/^\w+$/.test(name)) {
    return null;
  }
  const close = findMatchingParen(stmt, open);
  if (close < 0) {
    return null;
  }
  const inner = stmt.slice(open + 1, close);
  return { name, paramCount: countParametersInParens(inner), javadoc: null };
}

/**
 * Lightweight `.java` scan for Javadoc before type and methods (best-effort).
 */
export function parseJavaClassSkeleton(source: string, classFqn: string): JavaClassSkeleton {
  const classSimpleName = declaringSimpleName(classFqn);
  const methods: JavaMethodSkeleton[] = [];
  let typeJavadoc: string | null = null;
  let sealedType = false;

  const jdoc = /\/\*\*([\s\S]*?)\*\//g;
  let m: RegExpExecArray | null;
  while ((m = jdoc.exec(source)) !== null) {
    const doc = normalizeJavadoc(m[1] ?? '');
    const after = source.slice(m.index + m[0].length);
    const meth = parseMethodAfterJavadoc(after, classSimpleName);
    if (meth) {
      methods.push({ name: meth.name, paramCount: meth.paramCount, javadoc: doc });
      continue;
    }
    const stmt = skipWhitespaceAndAnnotations(after);
    if (!sealedType && (/\b(class|interface|enum|record)\s+/.test(stmt) || /@interface\b/.test(stmt))) {
      typeJavadoc = doc;
      sealedType = true;
    }
  }

  return { typeJavadoc, methods };
}

export function pickMethodJavadoc(
  skeleton: JavaClassSkeleton | null,
  name: string,
  paramCount: number,
): string | null {
  if (!skeleton) {
    return null;
  }
  const hits = skeleton.methods.filter((x) => x.name === name && x.paramCount === paramCount);
  return hits[0]?.javadoc ?? null;
}
