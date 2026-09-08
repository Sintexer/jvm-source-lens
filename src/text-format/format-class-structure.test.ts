import { expect, test } from 'bun:test';
import type { GetClassStructureSuccess } from '../class-structure/types.js';
import { formatClassStructureMethodLine } from './format-method-line.js';
import { formatClassStructureText } from './format-class-structure.js';

const baseResult: GetClassStructureSuccess = {
  ok: true,
  className: 'com.example.Calc',
  kind: 'class',
  superclass: 'java.lang.Object',
  interfaces: [],
  typeParameters: [],
  fields: [
    {
      name: 'x',
      declaringClass: 'com.example.Calc',
      visibility: 'private',
      type: 'int',
      static: false,
      final: false,
      enumConstant: false,
      javadoc: null,
    },
  ],
  methods: [
    {
      name: 'calculate',
      jvmMethodName: 'calculate',
      declaringClass: 'com.example.Calc',
      visibility: 'public',
      returnType: 'long',
      parameters: [
        { name: 'price', type: 'long' },
        { name: 'quantity', type: 'long' },
      ],
      typeParameters: [],
      javadoc: null,
      abstract: false,
      static: false,
      throws: [],
      genericSignature: null,
      jvmDescriptor: '#SRC:calculate',
      inherited: false,
    },
    {
      name: 'hashCode',
      jvmMethodName: 'hashCode',
      declaringClass: 'java.lang.Object',
      visibility: 'public',
      returnType: 'int',
      parameters: [],
      typeParameters: [],
      javadoc: null,
      abstract: false,
      static: false,
      throws: [],
      genericSignature: null,
      jvmDescriptor: '()I',
      inherited: true,
    },
  ],
  sourceAvailable: true,
  provenance: {
    kind: 'sourcesJar',
    coordinates: { group: 'g', name: 'a', version: '1' },
    jarPath: '/tmp/a-sources.jar',
  },
  classPurpose: 'Adds numbers for trading.',
};

test('formatClassStructureMethodLine renders parameter types and names', () => {
  const line = formatClassStructureMethodLine(baseResult.methods[0]!);
  expect(line).toContain('calculate(long price, long quantity)');
  expect(line).toMatch(/^\s*P long calculate\(/);
});

test('formatClassStructureMethodLine abbreviates public static', () => {
  const line = formatClassStructureMethodLine({
    ...baseResult.methods[0]!,
    name: 'empty',
    jvmMethodName: 'empty',
    static: true,
    returnType: 'void',
    parameters: [],
  });
  expect(line).toBe('  Ps void empty()');
});

test('formatClassStructureText overview omits signature lines', () => {
  const text = formatClassStructureText(baseResult, { scope: 'overview', classPurpose: 'Adds numbers.' });
  expect(text).toContain('Purpose: Adds numbers.');
  expect(text).toContain('Declared method names');
  expect(text).toContain('calculate');
  expect(text).not.toContain('long price');
  expect(text).toContain('Inherited methods: 1');
  expect(text).toContain('Fields: 1 (use scope=declared to list)');
});

test('formatClassStructureText overview lists fields for field-heavy constants class', () => {
  const fields = Array.from({ length: 10 }, (_, i) => ({
    name: i === 9 ? 'HOUR' : `F${i}`,
    declaringClass: 'com.example.TimeConstants',
    visibility: 'public' as const,
    type: 'long',
    static: true,
    final: true,
    enumConstant: false,
    javadoc: null,
  }));
  const result: GetClassStructureSuccess = {
    ...baseResult,
    className: 'com.example.TimeConstants',
    fields,
    methods: [
      {
        name: 'TimeConstants',
        jvmMethodName: '<init>',
        declaringClass: 'com.example.TimeConstants',
        visibility: 'private',
        returnType: 'void',
        parameters: [],
        typeParameters: [],
        javadoc: null,
        abstract: false,
        static: false,
        throws: [],
        genericSignature: null,
        jvmDescriptor: '()V',
        inherited: false,
      },
    ],
  };
  const text = formatClassStructureText(result, { scope: 'overview' });
  expect(text).toContain('Psf long HOUR');
  expect(text).toContain('Fields (10):');
  expect(text).not.toContain('use scope=declared to list)');
});

test('formatClassStructureText overview still hides fields for method-heavy types', () => {
  const fields = Array.from({ length: 10 }, (_, i) => ({
    name: `f${i}`,
    declaringClass: 'com.example.Service',
    visibility: 'private' as const,
    type: 'int',
    static: false,
    final: false,
    enumConstant: false,
    javadoc: null,
  }));
  const methods = Array.from({ length: 5 }, (_, i) => ({
    ...baseResult.methods[0]!,
    name: `m${i}`,
    jvmMethodName: `m${i}`,
    inherited: false as const,
  }));
  const result: GetClassStructureSuccess = {
    ...baseResult,
    fields,
    methods,
  };
  const text = formatClassStructureText(result, { scope: 'overview' });
  expect(text).toContain('Fields: 10 (use scope=declared to list)');
  expect(text).not.toContain('int f0');
});

test('formatClassStructureText declared lists declaration lines', () => {
  const text = formatClassStructureText(baseResult, { scope: 'declared' });
  expect(text).toContain('Methods — declared');
  expect(text).toContain('calculate(long price, long quantity)');
  expect(text).not.toContain('hashCode');
});

test('formatClassStructureText declared field line uses compact modifiers', () => {
  const result: GetClassStructureSuccess = {
    ...baseResult,
    fields: [
      {
        name: 'ZERO',
        declaringClass: 'com.example.TimeConstants',
        visibility: 'public',
        type: 'long',
        static: true,
        final: true,
        enumConstant: false,
        javadoc: null,
      },
    ],
    methods: [],
  };
  const text = formatClassStructureText(result, { scope: 'declared' });
  expect(text).toContain('Psf long ZERO');
  expect(text).not.toContain('public static final');
});
