import { describe, expect, test } from 'bun:test';
import { formatCompactModifiers } from './format-compact-modifiers.js';

describe('formatCompactModifiers', () => {
  test('public combinations use P', () => {
    expect(formatCompactModifiers({ visibility: 'public' })).toBe('P ');
    expect(formatCompactModifiers({ visibility: 'public', static: true })).toBe('Ps ');
    expect(formatCompactModifiers({ visibility: 'public', static: true, final: true })).toBe(
      'Psf ',
    );
    expect(formatCompactModifiers({ visibility: 'public', abstract: true })).toBe('Pa ');
    expect(
      formatCompactModifiers({ visibility: 'public', static: true, abstract: true, final: true }),
    ).toBe('Psaf ');
  });

  test('private uses p; protected keeps prot with space before flags', () => {
    expect(formatCompactModifiers({ visibility: 'private' })).toBe('p ');
    expect(formatCompactModifiers({ visibility: 'private', final: true })).toBe('pf ');
    expect(formatCompactModifiers({ visibility: 'private', static: true, final: true })).toBe(
      'psf ',
    );
    expect(formatCompactModifiers({ visibility: 'protected', abstract: true })).toBe('prot a ');
    expect(formatCompactModifiers({ visibility: 'protected', static: true, final: true })).toBe(
      'prot sf ',
    );
    expect(formatCompactModifiers({ visibility: 'protected' })).toBe('prot ');
  });

  test('package-private uses pack', () => {
    expect(formatCompactModifiers({ visibility: 'package' })).toBe('pack ');
    expect(formatCompactModifiers({ visibility: 'package', static: true, final: true })).toBe(
      'pack sf ',
    );
  });
});
