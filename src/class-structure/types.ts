import type { ArtifactCoordinates, ClassSourceError } from '../extractor/class-source-types.js';

/** javap-derived overload (structured view over bytecode metadata). */
export type JavapMethodOverload = {
  /** javap declaration line (human-readable erasure form when present). */
  declarationLine: string;
  visibility: 'public' | 'protected' | 'package' | 'private';
  /** Erased JVM descriptor for the method, e.g. `(I)Ljava/lang/String;`. */
  jvmDescriptor: string;
  /** Generic JVM Signature attribute when present (may be null). */
  genericSignature: string | null;
  /** Display return type parsed from the declaration line when possible; else erased guess from descriptor. */
  returnTypeDisplay: string | null;
  parameters: JavapParameter[];
  /** Checked exceptions listed on the method (`Exceptions` attribute). */
  thrownExceptions: string[];
  /** Raw `flags:` line from javap when present. */
  flagsLine: string | null;
};

export type JavapParameter = {
  name: string | null;
  /** Source-style parameter type when parsed from the declaration; else JVM descriptor slice. */
  typeDisplay: string;
};

export type MethodSignatureProvenance = {
  kind: 'classpathJar';
  coordinates: ArtifactCoordinates;
  jarPath: string;
};

export type ClassStructureKind = 'class' | 'interface' | 'enum' | 'annotation' | 'record';

export type JavapClassKind = ClassStructureKind;

export type JavapClassHeader = {
  kind: JavapClassKind;
  declarationLine: string;
  flagsLine: string | null;
  /** `null` means implicit `java.lang.Object` or not applicable (interfaces). */
  superClass: string | null;
  directInterfaces: string[];
  typeParameterNames: string[];
};

export type JavapFieldInfo = {
  declarationLine: string;
  visibility: 'public' | 'protected' | 'package' | 'private';
  jvmDescriptor: string;
  flagsLine: string | null;
  enumConstant: boolean;
};

export type JavapMethodWithName = JavapMethodOverload & { jvmMethodName: string };

export type ClassStructureParameter = {
  name: string | null;
  type: string;
};

export type ClassStructureMethod = {
  name: string;
  /** Bytecode name (`<init>` for constructors). */
  jvmMethodName: string;
  declaringClass: string;
  visibility: 'public' | 'protected' | 'package' | 'private';
  returnType: string;
  parameters: ClassStructureParameter[];
  typeParameters: string[];
  javadoc: string | null;
  abstract: boolean;
  static: boolean;
  throws: string[];
  genericSignature: string | null;
  jvmDescriptor: string;
  inherited: boolean;
};

export type ClassStructureField = {
  name: string;
  declaringClass: string;
  visibility: 'public' | 'protected' | 'package' | 'private';
  type: string;
  static: boolean;
  final: boolean;
  enumConstant: boolean;
  javadoc: string | null;
};

export type ClassStructureProvenance = MethodSignatureProvenance;

export type GetClassStructureSuccess = {
  ok: true;
  className: string;
  kind: ClassStructureKind;
  superclass: string | null;
  interfaces: string[];
  typeParameters: string[];
  fields: ClassStructureField[];
  methods: ClassStructureMethod[];
  sourceAvailable: boolean;
  provenance: ClassStructureProvenance;
};

export type GetClassStructureResult = GetClassStructureSuccess | { ok: false; error: ClassSourceError };
