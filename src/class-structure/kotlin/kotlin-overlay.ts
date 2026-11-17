import {
  kotlinJvmMethods,
  kotlinTypeMatchesJvm,
  type KotlinJvmMethod,
  type KotlinJvmRole,
} from './kotlin-jvm-names.js';
import { parseKotlinTypeMetadata } from './parse-kotlin-type-metadata.js';

export type OverlayParam = { name: string; synthetic: boolean };

export type OverlayMatch = {
  /** Parameter names in JVM order. A synthetic slot has no source parameter. */
  params: OverlayParam[];
  kdoc: string | null;
  role: KotlinJvmRole;
};

/**
 * What the `.kt` source adds to a class read from bytecode: KDoc and real parameter names.
 * javap stays the source of truth for names, types and overloads.
 */
export type KotlinOverlay = {
  typeKdoc: string | null;
  /** The source member for a javap method, or null when none fits one way only. Never guesses. */
  matchMethod(jvmName: string, paramTypes: readonly string[]): OverlayMatch | null;
  fieldKdoc(fieldName: string): string | null;
};

function isGeneratedHelper(jvmName: string): boolean {
  return (
    jvmName.endsWith('$default') ||
    jvmName.includes('$$') ||
    jvmName.startsWith('access$') ||
    jvmName.includes('$lambda')
  );
}

function nameFits(candidate: KotlinJvmMethod, jvmName: string): boolean {
  if (candidate.jvmName === jvmName) {
    return true;
  }
  if (!candidate.canBeMangled || !jvmName.startsWith(candidate.jvmName)) {
    return false;
  }
  const rest = jvmName.slice(candidate.jvmName.length);
  return /^-[A-Za-z0-9_]+$/.test(rest) || /^\$[A-Za-z0-9_]+$/.test(rest);
}

/** Number of matching typed positions, or -1 when a known type contradicts the javap type. */
function typeScore(candidate: KotlinJvmMethod, paramTypes: readonly string[]): number {
  let score = 0;
  for (let i = 0; i < candidate.params.length; i++) {
    const slot = candidate.params[i]!;
    if (slot.synthetic || slot.kotlinType === null) {
      continue;
    }
    const verdict = kotlinTypeMatchesJvm(slot.kotlinType, paramTypes[i] ?? '');
    if (verdict === 'mismatch') {
      return -1;
    }
    if (verdict === 'match') {
      score++;
    }
  }
  return score;
}

export function buildKotlinOverlay(source: string, className: string): KotlinOverlay | null {
  const meta = parseKotlinTypeMetadata(source, className);
  if (!meta) {
    return null;
  }
  const generated = kotlinJvmMethods(meta, true);
  const properties = [...meta.members, ...(meta.companion?.members ?? [])].filter((m) => m.kind === 'property');

  return {
    typeKdoc: meta.typeKdoc,
    matchMethod(jvmName, paramTypes) {
      if (isGeneratedHelper(jvmName)) {
        return null;
      }
      const seen = new Set<string>();
      const scored: Array<{ method: KotlinJvmMethod; score: number }> = [];
      for (const method of generated) {
        if (method.params.length !== paramTypes.length || !nameFits(method, jvmName)) {
          continue;
        }
        const key = `${method.member.start}:${method.role}:${method.params.length}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const score = typeScore(method, paramTypes);
        if (score >= 0) {
          scored.push({ method, score });
        }
      }
      if (scored.length === 0) {
        return null;
      }
      const best = Math.max(...scored.map((s) => s.score));
      const winners = scored.filter((s) => s.score === best);
      if (winners.length !== 1) {
        return null;
      }
      const { method } = winners[0]!;
      return {
        params: method.params.map((p) => ({ name: p.name, synthetic: p.synthetic })),
        kdoc: method.kdoc,
        role: method.role,
      };
    },
    fieldKdoc(fieldName) {
      return properties.find((p) => p.name === fieldName)?.kdoc ?? null;
    },
  };
}
