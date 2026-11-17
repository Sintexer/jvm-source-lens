import type { KotlinMember, KotlinParameter, KotlinTypeMetadata } from './parse-kotlin-type-metadata.js';

/**
 * Maps Kotlin source members to the JVM methods the compiler generates for them, so a javap
 * method can be paired with its Kotlin declaration (KDoc, parameter names).
 */

export type JvmParamSlot = {
  name: string;
  /** Receiver, `Continuation`, or enum name/ordinal: a slot with no source parameter. */
  synthetic: boolean;
  kotlinType: string | null;
};

export type KotlinJvmRole = 'fun' | 'getter' | 'setter' | 'constructor' | 'component' | 'copy';

export type KotlinJvmMethod = {
  jvmName: string;
  /** A javap name `jvmName-<hash>` or `jvmName$<module>` may belong to this member. */
  canBeMangled: boolean;
  params: JvmParamSlot[];
  role: KotlinJvmRole;
  member: KotlinMember;
  /** KDoc that belongs to the generated method. */
  kdoc: string | null;
};

const PRIMITIVES: Record<string, { prim: string; boxed: string }> = {
  Int: { prim: 'int', boxed: 'java.lang.Integer' },
  Long: { prim: 'long', boxed: 'java.lang.Long' },
  Short: { prim: 'short', boxed: 'java.lang.Short' },
  Byte: { prim: 'byte', boxed: 'java.lang.Byte' },
  Char: { prim: 'char', boxed: 'java.lang.Character' },
  Boolean: { prim: 'boolean', boxed: 'java.lang.Boolean' },
  Double: { prim: 'double', boxed: 'java.lang.Double' },
  Float: { prim: 'float', boxed: 'java.lang.Float' },
};

const PRIMITIVE_ARRAYS: Record<string, string> = {
  IntArray: 'int[]',
  LongArray: 'long[]',
  ShortArray: 'short[]',
  ByteArray: 'byte[]',
  CharArray: 'char[]',
  BooleanArray: 'boolean[]',
  DoubleArray: 'double[]',
  FloatArray: 'float[]',
};

const MAPPED_REFERENCES: Record<string, string> = {
  String: 'java.lang.String',
  Any: 'java.lang.Object',
  CharSequence: 'java.lang.CharSequence',
  Number: 'java.lang.Number',
  Throwable: 'java.lang.Throwable',
  Comparable: 'java.lang.Comparable',
  Enum: 'java.lang.Enum',
  Iterable: 'java.lang.Iterable',
  MutableIterable: 'java.lang.Iterable',
  Collection: 'java.util.Collection',
  MutableCollection: 'java.util.Collection',
  List: 'java.util.List',
  MutableList: 'java.util.List',
  Set: 'java.util.Set',
  MutableSet: 'java.util.Set',
  Map: 'java.util.Map',
  MutableMap: 'java.util.Map',
  Unit: 'kotlin.Unit',
  Nothing: 'java.lang.Void',
};

function stripGenerics(type: string): string {
  const lt = type.indexOf('<');
  return (lt < 0 ? type : type.slice(0, lt)).trim();
}

function normalizeKotlinType(raw: string): string {
  let t = raw.trim();
  while (t.startsWith('@')) {
    t = t.replace(/^@[\w.$:]+(\([^)]*\))?\s*/, '');
  }
  return t.replace(/^(out|in)\s+/, '').trim();
}

function isFunctionType(t: string): boolean {
  return /^(suspend\s+)?\(.*\)\s*->/.test(t) || /^(suspend\s+)?[\w.<>?, ]+\.\(.*\)\s*->/.test(t);
}

/** JVM type that a Kotlin type is compiled to, or null when it cannot be known from source. */
function expectedJvmType(kotlinType: string): string | null {
  let t = normalizeKotlinType(kotlinType);
  if (isFunctionType(t)) {
    return 'kotlin.jvm.functions.Function';
  }
  const nullable = t.endsWith('?');
  if (nullable) {
    t = t.slice(0, -1).trim();
  }
  const base = stripGenerics(t);
  const prim = PRIMITIVES[base];
  if (prim) {
    return nullable ? prim.boxed : prim.prim;
  }
  if (PRIMITIVE_ARRAYS[base]) {
    return PRIMITIVE_ARRAYS[base]!;
  }
  if (base === 'Array') {
    return '[]';
  }
  return MAPPED_REFERENCES[base] ?? null;
}

function simpleJvmName(jvmType: string): string {
  const cut = Math.max(jvmType.lastIndexOf('.'), jvmType.lastIndexOf('$'));
  return cut < 0 ? jvmType : jvmType.slice(cut + 1);
}

/**
 * Compares a Kotlin type as written with a javap parameter type. `unknown` covers type
 * parameters, type aliases and inline classes, whose JVM type is not the written name.
 */
export function kotlinTypeMatchesJvm(kotlinType: string, jvmType: string): 'match' | 'mismatch' | 'unknown' {
  // javap shows a vararg as `T...`; it is a `T[]` on the JVM. Check the array suffix before generics are cut.
  const raw = jvmType.trim().replace(/\.\.\.$/, '[]');
  const isArray = raw.endsWith('[]');
  const jvm = isArray ? `${stripGenerics(raw.slice(0, -2))}[]` : stripGenerics(raw);
  const expected = expectedJvmType(kotlinType);
  if (expected !== null) {
    if (expected === 'kotlin.jvm.functions.Function') {
      return jvm.startsWith('kotlin.jvm.functions.Function') ? 'match' : 'mismatch';
    }
    if (expected === '[]') {
      return isArray ? 'match' : 'mismatch';
    }
    return jvm === expected ? 'match' : 'mismatch';
  }
  const plain = stripGenerics(normalizeKotlinType(kotlinType).replace(/\?$/, ''));
  const simple = plain.slice(plain.lastIndexOf('.') + 1);
  if (simple.length > 0 && simple === simpleJvmName(jvm)) {
    return 'match';
  }
  return 'unknown';
}

function isBuiltinKnown(kotlinType: string | null): boolean {
  return kotlinType !== null && expectedJvmType(kotlinType) !== null;
}

function capitalize(name: string): string {
  return name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1);
}

function isBooleanStyleName(name: string): boolean {
  return /^is[A-Z]/.test(name);
}

export function getterName(m: KotlinMember): string {
  return m.getterJvmName ?? (isBooleanStyleName(m.name) ? m.name : `get${capitalize(m.name)}`);
}

export function setterName(m: KotlinMember): string {
  if (m.setterJvmName) {
    return m.setterJvmName;
  }
  return isBooleanStyleName(m.name) ? `set${m.name.slice(2)}` : `set${capitalize(m.name)}`;
}

const VARARG_PRIMITIVE_ELEMENT = /^(Int|Long|Short|Byte|Char|Boolean|Float|Double)$/;

function paramSlot(p: KotlinParameter): JvmParamSlot {
  // `vararg xs: Int` compiles to `int...`; a nullable or reference element stays `T[]`.
  const type = !p.vararg ? p.type : VARARG_PRIMITIVE_ELEMENT.test(p.type) ? `${p.type}Array` : `Array<${p.type}>`;
  return { name: p.name, synthetic: false, kotlinType: type.length > 0 ? type : null };
}

/** Parameter lists for a member: the full list, plus one shorter list per dropped trailing default under `@JvmOverloads`. */
function parameterVariants(parameters: KotlinParameter[], jvmOverloads: boolean, allDefaultsNoArg: boolean): KotlinParameter[][] {
  const variants: KotlinParameter[][] = [parameters];
  if (jvmOverloads) {
    let current = parameters;
    for (let i = parameters.length - 1; i >= 0; i--) {
      if (!parameters[i]!.hasDefault) {
        continue;
      }
      current = current.filter((p) => p !== parameters[i]);
      variants.push(current);
    }
  } else if (allDefaultsNoArg && parameters.length > 0 && parameters.every((p) => p.hasDefault)) {
    variants.push([]);
  }
  return variants;
}

function functionMethods(m: KotlinMember, internalOwner: boolean): KotlinJvmMethod[] {
  const out: KotlinJvmMethod[] = [];
  const jvmName = m.jvmName ?? m.name;
  for (const variant of parameterVariants(m.parameters, m.jvmOverloads, false)) {
    const params: JvmParamSlot[] = [];
    if (m.receiver !== null) {
      params.push({ name: '$receiver', synthetic: true, kotlinType: m.receiver });
    }
    params.push(...variant.map(paramSlot));
    if (m.isSuspend) {
      params.push({ name: '$completion', synthetic: true, kotlinType: null });
    }
    out.push({
      jvmName,
      canBeMangled:
        m.visibility === 'internal' ||
        internalOwner ||
        params.some((p) => !p.synthetic && !isBuiltinKnown(p.kotlinType)),
      params,
      role: 'fun',
      member: m,
      kdoc: m.kdoc,
    });
  }
  return out;
}

function propertyMethods(m: KotlinMember): KotlinJvmMethod[] {
  if (m.jvmField || m.isConst) {
    return [];
  }
  const hidden = m.visibility === 'private';
  const out: KotlinJvmMethod[] = [];
  const receiver: JvmParamSlot[] =
    m.receiver !== null ? [{ name: '$receiver', synthetic: true, kotlinType: m.receiver }] : [];
  if (!hidden || m.hasCustomGetter) {
    out.push({
      jvmName: getterName(m),
      canBeMangled: m.visibility === 'internal',
      params: receiver,
      role: 'getter',
      member: m,
      kdoc: m.kdoc,
    });
  }
  if (m.mutable && (!hidden || m.hasCustomSetter)) {
    out.push({
      jvmName: setterName(m),
      canBeMangled: m.visibility === 'internal',
      params: [...receiver, { name: 'value', synthetic: false, kotlinType: m.type }],
      role: 'setter',
      member: m,
      kdoc: m.kdoc,
    });
  }
  return out;
}

function constructorMethods(m: KotlinMember, enumType: boolean, innerType: boolean): KotlinJvmMethod[] {
  const out: KotlinJvmMethod[] = [];
  for (const variant of parameterVariants(m.parameters, m.jvmOverloads, true)) {
    const params: JvmParamSlot[] = [];
    if (innerType) {
      params.push({ name: 'this$0', synthetic: true, kotlinType: null });
    }
    if (enumType) {
      params.push(
        { name: '$enum$name', synthetic: true, kotlinType: 'String' },
        { name: '$enum$ordinal', synthetic: true, kotlinType: 'Int' },
      );
    }
    params.push(...variant.map(paramSlot));
    out.push({
      jvmName: '<init>',
      canBeMangled: false,
      params,
      role: 'constructor',
      member: m,
      kdoc: m.kdoc,
    });
  }
  return out;
}

function dataClassMethods(meta: KotlinTypeMetadata, ctor: KotlinMember | undefined): KotlinJvmMethod[] {
  if (!meta.isData || !ctor) {
    return [];
  }
  const out: KotlinJvmMethod[] = [];
  const props = ctor.parameters.filter((p) => p.property !== null);
  props.forEach((p, i) => {
    const member = meta.members.find((m) => m.kind === 'property' && m.name === p.name) ?? ctor;
    out.push({
      jvmName: `component${i + 1}`,
      canBeMangled: false,
      params: [],
      role: 'component',
      member,
      kdoc: member.kdoc,
    });
  });
  out.push({
    jvmName: 'copy',
    canBeMangled: false,
    params: ctor.parameters.map(paramSlot),
    role: 'copy',
    member: ctor,
    kdoc: null,
  });
  return out;
}

/**
 * JVM methods generated for `meta`'s members. With `includeCompanionStatics`, companion members
 * annotated `@JvmStatic` also appear (as static methods of the outer class).
 */
export function kotlinJvmMethods(meta: KotlinTypeMetadata, includeCompanionStatics: boolean): KotlinJvmMethod[] {
  const out: KotlinJvmMethod[] = [];
  const enumType = meta.kind === 'enum';
  const ctors = meta.members.filter((m) => m.kind === 'constructor');
  for (const m of meta.members) {
    if (m.kind === 'fun') {
      out.push(...functionMethods(m, false));
    } else if (m.kind === 'property') {
      out.push(...propertyMethods(m));
    } else {
      out.push(...constructorMethods(m, enumType, meta.isInner));
    }
  }
  out.push(...dataClassMethods(meta, ctors[0]));
  if (includeCompanionStatics && meta.companion) {
    for (const m of meta.companion.members) {
      if (!m.jvmStatic) {
        continue;
      }
      if (m.kind === 'fun') {
        out.push(...functionMethods(m, false));
      } else if (m.kind === 'property') {
        out.push(...propertyMethods(m));
      }
    }
  }
  return out;
}
