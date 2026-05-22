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
});

test('formatClassStructureText overview omits signature lines', () => {
  const text = formatClassStructureText(baseResult, { scope: 'overview', classPurpose: 'Adds numbers.' });
  expect(text).toContain('Purpose: Adds numbers.');
  expect(text).toContain('Declared method names');
  expect(text).toContain('calculate');
  expect(text).not.toContain('long price');
  expect(text).toContain('Inherited methods: 1');
});

test('formatClassStructureText declared lists declaration lines', () => {
  const text = formatClassStructureText(baseResult, { scope: 'declared' });
  expect(text).toContain('Methods — declared');
  expect(text).toContain('calculate(long price, long quantity)');
  expect(text).not.toContain('hashCode');
});
