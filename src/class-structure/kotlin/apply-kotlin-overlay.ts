import type { KotlinOverlay } from './kotlin-overlay.js';

/**
 * Names the parameters of one javap method from its Kotlin declaration. A synthetic slot (extension
 * receiver, `Continuation`) keeps the javap name when javap has one. Returns null when no source
 * member fits, and the caller keeps the javap data unchanged.
 */
export function overlayMethodParameters<P extends { name: string | null }>(
  overlay: KotlinOverlay,
  jvmName: string,
  params: readonly P[],
  typeOf: (p: P) => string,
): { params: P[]; kdoc: string | null } | null {
  const match = overlay.matchMethod(jvmName, params.map(typeOf));
  if (!match) {
    return null;
  }
  return {
    params: params.map((p, i) => {
      const slot = match.params[i];
      if (!slot) {
        return p;
      }
      return { ...p, name: slot.synthetic ? (p.name ?? slot.name) : slot.name };
    }),
    kdoc: match.kdoc,
  };
}
