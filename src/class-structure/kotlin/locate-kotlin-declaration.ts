import type { TypeDeclarationSpan } from '../locate-type-declaration.js';
import { membersRegion, scanKotlinDeclarations, type KotlinRawDeclaration } from './kotlin-declarations.js';

function isTypeNamed(d: KotlinRawDeclaration, name: string): boolean {
  if (d.keyword !== 'class' && d.keyword !== 'interface' && d.keyword !== 'object') {
    return false;
  }
  if (d.name === name) {
    return true;
  }
  return name === 'Companion' && d.name === '' && d.modifiers.includes('companion');
}

/**
 * The declaration of the nested type path `names` (`['Outer', 'Inner']`). An unnamed
 * `companion object` is named `Companion`.
 */
export function findKotlinTypeDeclaration(source: string, names: readonly string[]): KotlinRawDeclaration | null {
  if (names.length === 0 || names.some((n) => n.length === 0)) {
    return null;
  }
  let from = 0;
  let to = source.length;
  let found: KotlinRawDeclaration | null = null;
  for (const name of names) {
    found = scanKotlinDeclarations(source, from, to).find((d) => isTypeNamed(d, name)) ?? null;
    if (!found) {
      return null;
    }
    const region = membersRegion(source, found);
    if (name === names[names.length - 1]) {
      break;
    }
    if (!region) {
      return null;
    }
    from = region.from;
    to = region.to;
  }
  return found;
}

/**
 * Span of a Kotlin type declaration, KDoc and annotations included. A type without a body
 * (`class Foo(val x: Int)`) has `openBrace: -1` and ends at its declaration end.
 */
export function locateKotlinTypeDeclaration(source: string, names: readonly string[]): TypeDeclarationSpan | null {
  const d = findKotlinTypeDeclaration(source, names);
  if (!d) {
    return null;
  }
  return { start: d.start, openBrace: d.openBrace, closeBrace: d.openBrace >= 0 ? d.closeBrace : d.end - 1 };
}
