import type { ClassStructureMethod } from '../class-structure/types.js';
import type { JavapMethodOverload } from '../class-structure/types.js';
import { formatCompactModifiers } from './format-compact-modifiers.js';

function formatParamsFromStructure(m: ClassStructureMethod): string {
  return m.parameters.map((p) => (p.name ? `${p.type} ${p.name}` : p.type)).join(', ');
}

function formatParamsFromJavap(o: JavapMethodOverload): string {
  return o.parameters.map((p) => (p.name ? `${p.typeDisplay} ${p.name}` : p.typeDisplay)).join(', ');
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
  const throws =
    m.throws.length > 0 ? ` throws ${m.throws.join(', ')}` : '';
  return `${mods}${m.returnType} ${m.name}(${formatParamsFromStructure(m)})${throws}`;
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
  const throws =
    o.thrownExceptions.length > 0 ? ` throws ${o.thrownExceptions.join(', ')}` : '';
  const params = formatParamsFromJavap(o);

  if (opts.methodName === '<init>') {
    const ctorName = opts.className ? simpleNameFromFqn(opts.className) : 'init';
    return `  ${mods}${ctorName}(${params})${throws}`;
  }

  const ret = o.returnTypeDisplay ?? 'void';
  return `  ${mods}${ret} ${opts.methodName}(${params})${throws}`;
}
