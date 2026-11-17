import type { ClassStructureMethod } from '../class-structure/types.js';
import type { JavapMethodOverload } from '../class-structure/types.js';
import { stripLeadingModifiers } from '../class-structure/strip-leading-modifiers.js';
import { formatCompactModifiers } from './format-compact-modifiers.js';

function formatParamsFromStructure(m: ClassStructureMethod): string {
  return m.parameters.map((p) => (p.name ? `${p.type} ${p.name}` : p.type)).join(', ');
}

function formatParamsFromJavap(o: JavapMethodOverload): string {
  return o.parameters.map((p) => (p.name ? `${p.typeDisplay} ${p.name}` : p.typeDisplay)).join(', ');
}

/** `java.io.IOException` → `IOException`, `p.Outer$Inner` → `Outer.Inner`; full names stay when two share a simple name. */
function formatThrows(names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }
  const short = names.map((n) => n.slice(n.lastIndexOf('.') + 1).replace(/\$/g, '.'));
  const shown = new Set(short).size === short.length ? short : names;
  return ` throws ${shown.join(', ')}`;
}

/** Method type parameters (`<T extends Foo>`) at the start of a declaration, after annotations and modifiers. */
function methodTypeParameters(declarationLine: string): string {
  let s = declarationLine.trimStart();
  for (;;) {
    const ann = /^@[\w$.]+(?:\s*\([^)]*\))?\s*/.exec(s);
    const next = stripLeadingModifiers(ann ? s.slice(ann[0].length) : s);
    if (next === s) {
      break;
    }
    s = next;
  }
  if (!s.startsWith('<')) {
    return '';
  }
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') {
      depth++;
    } else if (s[i] === '>' && --depth === 0) {
      return `${s.slice(0, i + 1)} `;
    }
  }
  return '';
}

function synthesizeStructureLine(m: ClassStructureMethod): string {
  const mods = formatCompactModifiers({
    visibility: m.visibility,
    static: m.static,
    abstract: m.abstract,
  });
  if (m.jvmMethodName === '<init>') {
    return `${mods}${m.name}(${formatParamsFromStructure(m)})`;
  }
  return `${mods}${m.returnType} ${m.name}(${formatParamsFromStructure(m)})${formatThrows(m.throws)}`;
}

/** IDE-style one-line method signature for compact text output. */
export function formatClassStructureMethodLine(m: ClassStructureMethod): string {
  if (m.inherited) {
    const prefix = `  /* ${m.declaringClass} */ `;
    return prefix + synthesizeStructureLine(m).trimStart();
  }
  return `  ${synthesizeStructureLine(m)}`;
}

export type FormatJavapOverloadLineOptions = {
  /** Logical method name; use `<init>` for constructors. */
  methodName: string;
  /** FQN of the owning class (used for constructor display name). */
  className?: string;
};

function simpleNameFromFqn(fqn: string): string {
  const dollar = fqn.lastIndexOf('$');
  if (dollar >= 0) {
    return fqn.slice(dollar + 1);
  }
  const dot = fqn.lastIndexOf('.');
  return dot >= 0 ? fqn.slice(dot + 1) : fqn;
}

/**
 * Compact overload line for get_method_signature.
 * Always synthesizes from structured fields (abbreviated modifiers) — never dumps raw declarationLine.
 */
export function formatJavapOverloadLine(
  o: JavapMethodOverload,
  opts: FormatJavapOverloadLineOptions,
): string {
  const mods = formatCompactModifiers({
    visibility: o.visibility,
    static: /\bstatic\b/.test(o.declarationLine) || Boolean(o.flagsLine?.includes('ACC_STATIC')),
    abstract:
      /\babstract\b/.test(o.declarationLine) || Boolean(o.flagsLine?.includes('ACC_ABSTRACT')),
  });
  const throws = formatThrows(o.thrownExceptions);
  const params = formatParamsFromJavap(o);

  if (opts.methodName === '<init>') {
    const ctorName = opts.className ? simpleNameFromFqn(opts.className) : 'init';
    return `  ${mods}${ctorName}(${params})${throws}`;
  }

  const ret = o.returnTypeDisplay ?? 'void';
  return `  ${mods}${methodTypeParameters(o.declarationLine)}${ret} ${opts.methodName}(${params})${throws}`;
}
