import type { ClassStructureMethod } from '../class-structure/types.js';
import type { JavapMethodOverload } from '../class-structure/types.js';

function visibilityPrefix(v: string): string {
  if (v === 'package') {
    return '';
  }
  return `${v} `;
}

function formatParamsFromStructure(m: ClassStructureMethod): string {
  return m.parameters.map((p) => (p.name ? `${p.type} ${p.name}` : p.type)).join(', ');
}

function formatParamsFromJavap(o: JavapMethodOverload): string {
  return o.parameters.map((p) => (p.name ? `${p.typeDisplay} ${p.name}` : p.typeDisplay)).join(', ');
}

function synthesizeStructureLine(m: ClassStructureMethod): string {
  const vis = visibilityPrefix(m.visibility);
  const st = m.static ? 'static ' : '';
  const ab = m.abstract ? 'abstract ' : '';
  if (m.jvmMethodName === '<init>') {
    return `${vis}${m.name}(${formatParamsFromStructure(m)})`;
  }
  const throws =
    m.throws.length > 0 ? ` throws ${m.throws.join(', ')}` : '';
  return `${vis}${st}${ab}${m.returnType} ${m.name}(${formatParamsFromStructure(m)})${throws}`;
}

/** IDE-style one-line method signature for compact text output. */
export function formatClassStructureMethodLine(m: ClassStructureMethod): string {
  if (m.inherited) {
    const prefix = `  /* ${m.declaringClass} */ `;
    return prefix + synthesizeStructureLine(m).trimStart();
  }
  return `  ${synthesizeStructureLine(m)}`;
}

export function formatJavapOverloadLine(o: JavapMethodOverload): string {
  const decl = o.declarationLine.trim();
  if (decl.length > 0) {
    return `  ${decl.replace(/;$/, '')}`;
  }
  const vis = visibilityPrefix(o.visibility);
  const ret = o.returnTypeDisplay ?? 'void';
  const throws =
    o.thrownExceptions.length > 0 ? ` throws ${o.thrownExceptions.join(', ')}` : '';
  return `  ${vis}${ret} name(${formatParamsFromJavap(o)})${throws}`;
}
