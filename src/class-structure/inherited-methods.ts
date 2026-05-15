import type { ClassStructureMethod } from './types.js';
import { isSyntheticJvmDescriptor } from './parse-java-type-metadata.js';

export function methodMergeKey(jvmMethodName: string, jvmDescriptor: string): string {
  return `${jvmMethodName}\0${jvmDescriptor}`;
}

export function structureMethodMergeKey(
  m: Pick<ClassStructureMethod, 'jvmMethodName' | 'jvmDescriptor' | 'parameters'>,
): string {
  if (m.jvmDescriptor == null) {
    const paramJoin = m.parameters.map((p) => p.type).join('|');
    return `${m.jvmMethodName}\0#SRC_DECL\0${paramJoin}`;
  }
  if (!isSyntheticJvmDescriptor(m.jvmDescriptor)) {
    return methodMergeKey(m.jvmMethodName, m.jvmDescriptor);
  }
  const paramJoin = m.parameters.map((p) => p.type).join('|');
  return `${m.jvmMethodName}\0${m.jvmDescriptor}\0${paramJoin}`;
}

/**
 * `inheritedLayers` ordered **furthest supertype first** (each layer is instance public/protected methods from one super).
 * Declared methods on the primary type always win over inherited entries with the same key.
 */
export function mergeDeclaredWithInheritedLayers(
  declared: ClassStructureMethod[],
  inheritedLayers: ClassStructureMethod[][],
): ClassStructureMethod[] {
  const inheritedOnly = new Map<string, ClassStructureMethod>();
  for (const layer of inheritedLayers) {
    for (const m of layer) {
      const k = structureMethodMergeKey(m);
      if (!inheritedOnly.has(k)) {
        inheritedOnly.set(k, m);
      }
    }
  }

  const declaredKeys = new Set<string>();
  const out: ClassStructureMethod[] = [];

  for (const m of declared) {
    const k = structureMethodMergeKey(m);
    declaredKeys.add(k);
    out.push(m);
  }

  for (const m of inheritedOnly.values()) {
    const k = structureMethodMergeKey(m);
    if (!declaredKeys.has(k)) {
      out.push(m);
    }
  }

  return out;
}
