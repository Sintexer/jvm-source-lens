import { expect, test } from 'bun:test';
import { mergeDeclaredWithInheritedLayers } from './inherited-methods.js';
import type { ClassStructureMethod } from './types.js';

function m(
  partial: Omit<ClassStructureMethod, 'jvmDescriptor'> & { jvmDescriptor?: string },
): ClassStructureMethod {
  return {
    jvmDescriptor: partial.jvmDescriptor ?? '()V',
    name: partial.name,
    jvmMethodName: partial.jvmMethodName,
    declaringClass: partial.declaringClass,
    visibility: partial.visibility,
    returnType: partial.returnType,
    parameters: partial.parameters,
    typeParameters: partial.typeParameters,
    javadoc: partial.javadoc,
    abstract: partial.abstract,
    static: partial.static,
    throws: partial.throws,
    genericSignature: partial.genericSignature,
    inherited: partial.inherited,
  };
}

test('subclass declaration wins over identical inherited descriptor', () => {
  const declared = [
    m({
      name: 'run',
      jvmMethodName: 'run',
      declaringClass: 'com.Child',
      visibility: 'public',
      returnType: 'void',
      parameters: [],
      typeParameters: [],
      javadoc: null,
      abstract: false,
      static: false,
      throws: [],
      genericSignature: null,
      inherited: false,
      jvmDescriptor: '()V',
    }),
  ];
  const inherited: ClassStructureMethod[][] = [
    [
      m({
        name: 'run',
        jvmMethodName: 'run',
        declaringClass: 'com.Parent',
        visibility: 'public',
        returnType: 'void',
        parameters: [],
        typeParameters: [],
        javadoc: null,
        abstract: false,
        static: false,
        throws: [],
        genericSignature: null,
        inherited: true,
        jvmDescriptor: '()V',
      }),
    ],
  ];
  const out = mergeDeclaredWithInheritedLayers(declared, inherited);
  expect(out).toHaveLength(1);
  expect(out[0]!.declaringClass).toBe('com.Child');
});

test('far layer filled first then nearer — nearer visible when child has no override', () => {
  const declared: ClassStructureMethod[] = [];
  const inherited: ClassStructureMethod[][] = [
    [
      m({
        name: 'a',
        jvmMethodName: 'a',
        declaringClass: 'gp',
        visibility: 'public',
        returnType: 'void',
        parameters: [],
        typeParameters: [],
        javadoc: null,
        abstract: false,
        static: false,
        throws: [],
        genericSignature: null,
        inherited: true,
        jvmDescriptor: '()V',
      }),
    ],
    [
      m({
        name: 'b',
        jvmMethodName: 'b',
        declaringClass: 'p',
        visibility: 'public',
        returnType: 'void',
        parameters: [],
        typeParameters: [],
        javadoc: null,
        abstract: false,
        static: false,
        throws: [],
        genericSignature: null,
        inherited: true,
        jvmDescriptor: '()V',
      }),
    ],
  ];
  const out = mergeDeclaredWithInheritedLayers(declared, inherited);
  const names = out.map((x) => x.jvmMethodName).sort();
  expect(names).toEqual(['a', 'b']);
});
