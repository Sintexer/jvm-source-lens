import {
  membersRegion,
  parseAnnotation,
  readWord,
  scanKotlinDeclarations,
  visibilityOf,
  type KotlinAnnotation,
  type KotlinRawDeclaration,
} from './kotlin-declarations.js';
import { matchingClose, skipKotlinNoise, splitTopLevel } from './kotlin-lexer.js';
import { findKotlinTypeDeclaration } from './locate-kotlin-declaration.js';

export type KotlinVisibility = 'public' | 'protected' | 'internal' | 'private';

export type KotlinParameter = {
  name: string;
  /** Type as written, whitespace collapsed. Empty when the parameter has no type. */
  type: string;
  hasDefault: boolean;
  vararg: boolean;
  /** `val` / `var` on a primary-constructor parameter. */
  property: 'val' | 'var' | null;
};

export type KotlinMember = {
  kind: 'fun' | 'property' | 'constructor';
  /** `<init>` for constructors. */
  name: string;
  receiver: string | null;
  parameters: KotlinParameter[];
  /** Return type of a function or declared type of a property. Null when inferred. */
  type: string | null;
  isSuspend: boolean;
  visibility: KotlinVisibility;
  mutable: boolean;
  isConst: boolean;
  hasCustomGetter: boolean;
  hasCustomSetter: boolean;
  jvmName: string | null;
  getterJvmName: string | null;
  setterJvmName: string | null;
  jvmStatic: boolean;
  jvmOverloads: boolean;
  jvmField: boolean;
  kdoc: string | null;
  /** `[start, end)` in the source, KDoc and annotations included. */
  start: number;
  end: number;
};

export type KotlinCompanion = {
  name: string;
  members: KotlinMember[];
};

export type KotlinTypeMetadata = {
  /** `facade` is the `FooKt` class of top-level declarations. */
  kind: 'class' | 'interface' | 'object' | 'enum' | 'annotation' | 'facade';
  name: string;
  isData: boolean;
  /** `inner class`: constructors take the outer instance as a synthetic first parameter. */
  isInner: boolean;
  typeKdoc: string | null;
  members: KotlinMember[];
  companion: KotlinCompanion | null;
};

function simpleNames(className: string): string[] {
  const dot = className.lastIndexOf('.');
  return (dot < 0 ? className : className.slice(dot + 1)).split('$');
}

const PARAMETER_MODIFIERS = new Set([
  'vararg',
  'noinline',
  'crossinline',
  'private',
  'public',
  'protected',
  'internal',
  'override',
  'open',
  'final',
]);

type ParsedParameter = KotlinParameter & {
  start: number;
  end: number;
  visibility: KotlinVisibility;
  annotations: KotlinAnnotation[];
};

function findTopLevelEquals(text: string, from: number): number {
  let depth = 0;
  let j = from;
  while (j < text.length) {
    const k = skipKotlinNoise(text, j);
    if (k !== j) {
      j = k;
      continue;
    }
    const c = text[j];
    if (c === '(' || c === '[' || c === '{' || c === '<') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}' || (c === '>' && text[j - 1] !== '-')) {
      depth = Math.max(0, depth - 1);
    } else if (c === '=' && depth === 0 && text[j + 1] !== '=' && text[j + 1] !== '>' && text[j - 1] !== '!') {
      return j;
    }
    j++;
  }
  return -1;
}

function parseOneParameter(segment: string, absStart: number, absEnd: number): ParsedParameter | null {
  let i = 0;
  let vararg = false;
  let property: 'val' | 'var' | null = null;
  let visibility: KotlinVisibility = 'public';
  const annotations: KotlinAnnotation[] = [];
  for (;;) {
    while (i < segment.length && /\s/.test(segment[i]!)) {
      i++;
    }
    if (segment[i] === '@') {
      const parsed = parseAnnotation(segment, i, segment.length);
      if (parsed) {
        annotations.push(parsed.ann);
        i = parsed.end;
        continue;
      }
      let j = i + 1;
      while (j < segment.length && /[A-Za-z0-9_.$:]/.test(segment[j]!)) {
        j++;
      }
      if (segment[j] === '(') {
        const close = matchingClose(segment, j, '(', ')');
        j = close < 0 ? segment.length : close + 1;
      }
      i = j;
      continue;
    }
    const w = readWord(segment, i, segment.length);
    if (!w) {
      return null;
    }
    if (w.text === 'val' || w.text === 'var') {
      property = w.text;
      i = w.end;
      continue;
    }
    if (PARAMETER_MODIFIERS.has(w.text) && /\s/.test(segment[w.end] ?? '')) {
      if (w.text === 'vararg') {
        vararg = true;
      }
      if (w.text === 'private' || w.text === 'protected' || w.text === 'internal' || w.text === 'public') {
        visibility = w.text;
      }
      i = w.end;
      continue;
    }
    i = w.end;
    const name = w.text;
    while (i < segment.length && /\s/.test(segment[i]!)) {
      i++;
    }
    if (segment[i] !== ':') {
      return { name, type: '', hasDefault: false, vararg, property, start: absStart, end: absEnd, visibility, annotations };
    }
    const eq = findTopLevelEquals(segment, i + 1);
    const typeText = segment.slice(i + 1, eq < 0 ? segment.length : eq).replace(/\s+/g, ' ').trim();
    return { name, type: typeText, hasDefault: eq >= 0, vararg, property, start: absStart, end: absEnd, visibility, annotations };
  }
}

export function parseKotlinParameters(text: string | null, baseOffset: number): ParsedParameter[] {
  if (text === null) {
    return [];
  }
  const out: ParsedParameter[] = [];
  for (const part of splitTopLevel(text)) {
    if (part.text.trim().length === 0) {
      continue;
    }
    const p = parseOneParameter(part.text, baseOffset + part.start, baseOffset + part.end);
    if (p) {
      out.push(p);
    }
  }
  return out;
}

function annotationNamed(anns: KotlinAnnotation[], name: string, useSite?: string): KotlinAnnotation | undefined {
  return anns.find((a) => a.name === name && (useSite === undefined || a.useSite === useSite));
}

function stringArg(a: KotlinAnnotation | undefined): string | null {
  if (!a || a.args === null) {
    return null;
  }
  const m = /"([^"]*)"/.exec(a.args);
  return m ? m[1]! : null;
}

function baseMember(kind: KotlinMember['kind'], d: KotlinRawDeclaration): KotlinMember {
  const anns = d.annotations;
  return {
    kind,
    name: d.name,
    receiver: d.receiver,
    parameters: [],
    type: d.type,
    isSuspend: d.modifiers.includes('suspend'),
    visibility: visibilityOf(d),
    mutable: d.keyword === 'var',
    isConst: d.modifiers.includes('const'),
    hasCustomGetter: d.hasGetter,
    hasCustomSetter: d.hasSetter,
    jvmName: stringArg(annotationNamed(anns, 'JvmName', undefined)?.useSite ? undefined : annotationNamed(anns, 'JvmName')),
    getterJvmName: stringArg(annotationNamed(anns, 'JvmName', 'get')),
    setterJvmName: stringArg(annotationNamed(anns, 'JvmName', 'set')),
    jvmStatic: annotationNamed(anns, 'JvmStatic') !== undefined,
    jvmOverloads: annotationNamed(anns, 'JvmOverloads') !== undefined,
    jvmField: annotationNamed(anns, 'JvmField') !== undefined,
    kdoc: d.kdoc,
    start: d.start,
    end: d.end,
  };
}

function toParameters(parsed: ParsedParameter[]): KotlinParameter[] {
  return parsed.map(({ name, type, hasDefault, vararg, property }) => ({ name, type, hasDefault, vararg, property }));
}

function memberFromDeclaration(d: KotlinRawDeclaration): KotlinMember | null {
  if (d.keyword === 'fun') {
    const m = baseMember('fun', d);
    m.parameters = toParameters(parseKotlinParameters(d.params, d.paramsStart));
    return m;
  }
  if (d.keyword === 'val' || d.keyword === 'var') {
    return baseMember('property', d);
  }
  if (d.keyword === 'constructor') {
    const m = baseMember('constructor', d);
    m.parameters = toParameters(parseKotlinParameters(d.params, d.paramsStart));
    return m;
  }
  return null;
}

/** `@property name text` or `@param name text` from the type's KDoc, for a constructor property. */
function kdocTag(typeKdoc: string | null, name: string): string | null {
  if (typeKdoc === null) {
    return null;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`@(?:property|param)\\s+${escaped}\\b[ \\t]*([\\s\\S]*?)(?=\\n\\s*@|$)`).exec(typeKdoc);
  const text = m?.[1]?.trim();
  return text && text.length > 0 ? text : null;
}

function constructorMembers(d: KotlinRawDeclaration): KotlinMember[] {
  const out: KotlinMember[] = [];
  const parsed = parseKotlinParameters(d.params, d.paramsStart);
  const ctorVisibility = d.ctorModifiers[0] as KotlinVisibility | undefined;
  const headerEnd = d.paramsEnd >= 0 ? d.paramsEnd : d.openBrace >= 0 ? d.openBrace : d.end;
  out.push({
    ...emptyMember('constructor', '<init>'),
    parameters: toParameters(parsed),
    visibility: ctorVisibility ?? 'public',
    start: d.start,
    end: Math.max(headerEnd, d.keywordIndex),
  });
  for (const p of parsed) {
    if (p.property === null) {
      continue;
    }
    out.push({
      ...emptyMember('property', p.name),
      type: p.type.length > 0 ? p.type : null,
      visibility: p.visibility,
      mutable: p.property === 'var',
      getterJvmName: stringArg(annotationNamed(p.annotations, 'JvmName', 'get')),
      setterJvmName: stringArg(annotationNamed(p.annotations, 'JvmName', 'set')),
      jvmField: annotationNamed(p.annotations, 'JvmField') !== undefined,
      kdoc: kdocTag(d.kdoc, p.name),
      start: p.start,
      end: p.end,
    });
  }
  return out;
}

function emptyMember(kind: KotlinMember['kind'], name: string): KotlinMember {
  return {
    kind,
    name,
    receiver: null,
    parameters: [],
    type: null,
    isSuspend: false,
    visibility: 'public',
    mutable: false,
    isConst: false,
    hasCustomGetter: false,
    hasCustomSetter: false,
    jvmName: null,
    getterJvmName: null,
    setterJvmName: null,
    jvmStatic: false,
    jvmOverloads: false,
    jvmField: false,
    kdoc: null,
    start: 0,
    end: 0,
  };
}

function kindOf(d: KotlinRawDeclaration): KotlinTypeMetadata['kind'] {
  if (d.keyword === 'interface') {
    return 'interface';
  }
  if (d.keyword === 'object') {
    return 'object';
  }
  if (d.modifiers.includes('enum')) {
    return 'enum';
  }
  if (d.modifiers.includes('annotation')) {
    return 'annotation';
  }
  return 'class';
}

function bodyDeclarations(source: string, d: KotlinRawDeclaration): KotlinRawDeclaration[] {
  const region = membersRegion(source, d);
  return region ? scanKotlinDeclarations(source, region.from, region.to) : [];
}

function typeFromDeclaration(source: string, d: KotlinRawDeclaration): KotlinTypeMetadata {
  const kind = kindOf(d);
  const body = bodyDeclarations(source, d);
  const members: KotlinMember[] = [];
  const hasSecondary = body.some((b) => b.keyword === 'constructor');
  if (kind === 'class' || kind === 'enum') {
    if (d.params !== null) {
      members.push(...constructorMembers(d));
    } else if (!hasSecondary) {
      members.push({
        ...emptyMember('constructor', '<init>'),
        start: d.start,
        end: Math.max(d.openBrace >= 0 ? d.openBrace : d.end, d.keywordIndex),
      });
    }
  }
  let companion: KotlinCompanion | null = null;
  for (const b of body) {
    if ((b.keyword === 'object' || b.keyword === 'class') && b.modifiers.includes('companion')) {
      companion = {
        name: b.name.length > 0 ? b.name : 'Companion',
        members: bodyDeclarations(source, b)
          .map(memberFromDeclaration)
          .filter((m): m is KotlinMember => m !== null && m.kind !== 'constructor'),
      };
      continue;
    }
    const m = memberFromDeclaration(b);
    if (m) {
      members.push(m);
    }
  }
  return {
    kind,
    name: d.name.length > 0 ? d.name : 'Companion',
    isData: d.modifiers.includes('data'),
    isInner: d.modifiers.includes('inner'),
    typeKdoc: d.kdoc,
    members,
    companion,
  };
}

/**
 * Members of the Kotlin type named by the binary `className`, or of the file's top-level
 * declarations when `className` is not a type in the file (the `FooKt` facade).
 * Companion members are returned on `companion`; asking for `Outer$Companion` returns them
 * as `members`. Null when the file declares neither.
 */
export function parseKotlinTypeMetadata(source: string, className: string): KotlinTypeMetadata | null {
  const names = simpleNames(className);
  const d = findKotlinTypeDeclaration(source, names);
  if (d) {
    return typeFromDeclaration(source, d);
  }
  if (names.length !== 1) {
    return null;
  }
  const members = scanKotlinDeclarations(source, 0, source.length)
    .map(memberFromDeclaration)
    .filter((m): m is KotlinMember => m !== null && m.kind !== 'constructor');
  if (members.length === 0) {
    return null;
  }
  return { kind: 'facade', name: names[0]!, isData: false, isInner: false, typeKdoc: null, members, companion: null };
}
