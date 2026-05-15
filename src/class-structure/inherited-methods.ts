import type { ClassStructureMethod } from './types.js';

export function methodMergeKey(jvmMethodName: string, jvmDescriptor: string): string {
  return `${jvmMethodName}\0${jvmDescriptor}`;
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
      const k = methodMergeKey(m.jvmMethodName, m.jvmDescriptor);
      if (!inheritedOnly.has(k)) {
        inheritedOnly.set(k, m);
      }
    }
  }

  const declaredKeys = new Set<string>();
  const out: ClassStructureMethod[] = [];

  for (const m of declared) {
    const k = methodMergeKey(m.jvmMethodName, m.jvmDescriptor);
    declaredKeys.add(k);
    out.push(m);
  }

  for (const m of inheritedOnly.values()) {
    const k = methodMergeKey(m.jvmMethodName, m.jvmDescriptor);
    if (!declaredKeys.has(k)) {
      out.push(m);
    }
  }

  return out;
}
