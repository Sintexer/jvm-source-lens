import { expect, test } from 'bun:test';
import type { JavapMethodOverload } from '../class-structure/types.js';
import { formatJavapOverloadLine } from './format-method-line.js';

const overload = (partial: Partial<JavapMethodOverload> & Pick<JavapMethodOverload, 'declarationLine'>): JavapMethodOverload => ({
  visibility: 'public',
  jvmDescriptor: '()V',
  genericSignature: null,
  returnTypeDisplay: 'void',
  parameters: [],
  thrownExceptions: [],
  flagsLine: null,
  ...partial,
});

test('formatJavapOverloadLine synthesizes abbreviated modifiers', () => {
  const line = formatJavapOverloadLine(
    overload({
      declarationLine: 'public static void empty();',
      returnTypeDisplay: 'void',
      flagsLine: 'flags: (0x0009) ACC_PUBLIC, ACC_STATIC',
    }),
    { methodName: 'empty', className: 'com.example.Box' },
  );
  expect(line).toBe('  Ps void empty()');
  expect(line).not.toContain('public static');
});

test('formatJavapOverloadLine formats constructors', () => {
  const line = formatJavapOverloadLine(
    overload({
      declarationLine: 'public com.example.Box(java.lang.String);',
      returnTypeDisplay: '',
      parameters: [{ name: 'name', typeDisplay: 'String' }],
    }),
    { methodName: '<init>', className: 'com.example.Box' },
  );
  expect(line).toBe('  P Box(String name)');
});
