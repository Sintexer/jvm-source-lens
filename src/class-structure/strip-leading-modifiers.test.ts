import { describe, expect, test } from 'bun:test';
import { stripLeadingModifiers } from './strip-leading-modifiers.js';

/** Mirrors type/name extraction in get-class-structure javapFieldToStructure. */
function typeAndNameFromFieldDecl(declarationLine: string): { type: string; name: string } {
  const decl = stripLeadingModifiers(declarationLine.replace(/;$/, '').trim());
  const withoutInit = decl.split('=')[0]!.trim();
  const parts = withoutInit.split(/\s+/).filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  const type = parts.slice(0, -1).join(' ').trim();
  return { type, name };
}

describe('stripLeadingModifiers', () => {
  test('strips visibility static final from field declaration', () => {
    expect(stripLeadingModifiers('public static final long ZERO')).toBe('long ZERO');
    expect(stripLeadingModifiers('private static final int X = 1')).toBe('int X = 1');
  });

  test('strips volatile and transient', () => {
    expect(stripLeadingModifiers('private volatile Object lock')).toBe('Object lock');
    expect(stripLeadingModifiers('protected transient String tmp')).toBe('String tmp');
  });

  test('leaves type-only declarations unchanged', () => {
    expect(stripLeadingModifiers('long ZERO')).toBe('long ZERO');
  });

  test('field type/name mapping ignores modifiers and initializers', () => {
    expect(typeAndNameFromFieldDecl('public static final long ZERO;')).toEqual({
      type: 'long',
      name: 'ZERO',
    });
    expect(typeAndNameFromFieldDecl('public static final long ZERO = 0L')).toEqual({
      type: 'long',
      name: 'ZERO',
    });
  });
});
