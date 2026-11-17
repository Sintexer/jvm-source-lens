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

test('shouldPrintMethodTypeParametersWhenDeclarationHasThem', () => {
  const line = formatJavapOverloadLine(
    overload({
      declarationLine: 'public <T extends java.lang.Comparable<T>> T readValue(java.lang.String, java.lang.Class<T>) throws java.io.IOException;',
      returnTypeDisplay: 'T',
      thrownExceptions: ['java.io.IOException'],
      parameters: [
        { name: 'content', typeDisplay: 'String' },
        { name: 'valueType', typeDisplay: 'Class<T>' },
      ],
    }),
    { methodName: 'readValue' },
  );
  expect(line).toBe('  P <T extends java.lang.Comparable<T>> T readValue(String content, Class<T> valueType) throws IOException');
});

test('shouldPrintSimpleThrowsNamesUnlessTwoShareASimpleName', () => {
  const simple = formatJavapOverloadLine(
    overload({
      declarationLine: 'public void run() throws java.io.IOException, com.x.Outer$Failure;',
      thrownExceptions: ['java.io.IOException', 'com.x.Outer$Failure'],
    }),
    { methodName: 'run' },
  );
  expect(simple).toBe('  P void run() throws IOException, Outer.Failure');

  const clash = formatJavapOverloadLine(
    overload({
      declarationLine: 'public void run() throws a.Oops, b.Oops;',
      thrownExceptions: ['a.Oops', 'b.Oops'],
    }),
    { methodName: 'run' },
  );
  expect(clash).toBe('  P void run() throws a.Oops, b.Oops');
});
