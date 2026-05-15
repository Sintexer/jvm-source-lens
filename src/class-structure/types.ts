import type { ArtifactCoordinates } from '../extractor/class-source-types.js';

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
