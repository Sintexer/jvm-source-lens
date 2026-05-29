/**
 * Projection helpers for get_class_structure MCP tool responses.
 *
 * Default full=true JSON: overview-shaped — className, kind, superclass, interfaces,
 * typeParameters, declaredMethodNames[], sourceAvailable, provenance (slim).
 *
 * Opt-in via scope or include:
 *   scope=declared  → adds declaredMethods[] with full signatures + fields[]
 *   scope=effective → same as declared + inheritedMethods[]
 *   include=['signatures'] → alias for declared method objects
 *   include=['fields']     → include fields[]
 *   include=['inherited']  → include inheritedMethods[]
 *   include=['provenance'] → full provenance object (not slim)
 *   include=['all']        → all of the above
 */

import type { GetClassStructureSuccess, ClassStructureMethod, ClassStructureScope } from '../class-structure/types.js';
import { isSyntheticJvmDescriptor } from '../class-structure/parse-java-type-metadata.js';
import { projectProvenance, type SlimProvenance } from './provenance.js';

export type ClassStructureIncludeSection =
  | 'signatures'
  | 'fields'
  | 'inherited'
  | 'hierarchy'
  | 'annotations'
  | 'provenance'
  | 'all';

function wantsSection(include: ClassStructureIncludeSection[] | undefined, s: ClassStructureIncludeSection): boolean {
  if (!include || include.length === 0) return false;
  return include.includes('all') || include.includes(s);
}

function scopeImpliesSignatures(scope: ClassStructureScope | undefined): boolean {
  return scope === 'declared' || scope === 'effective';
}

function scopeImpliesInherited(scope: ClassStructureScope | undefined): boolean {
  return scope === 'effective';
}

export type ProjectedMethodEntry = {
  name: string;
  declaringClass: string;
  visibility: 'public' | 'protected' | 'package' | 'private';
  returnType: string;
  parameters: Array<{ name: string | null; type: string }>;
  typeParameters: string[];
  throws: string[];
  abstract: boolean;
  static: boolean;
  javadoc?: string | null;
  jvmDescriptor?: string | null;
  genericSignature?: string | null;
  annotations?: Array<{ summary: string }>;
};

export type ProjectedFieldEntry = GetClassStructureSuccess['fields'][number];

export type ProjectedClassStructure = {
  ok: true;
  className: string;
  kind: 'class' | 'interface' | 'enum' | 'annotation' | 'record';
  superclass: string | null;
  interfaces: string[];
  typeParameters: string[];
  sourceAvailable: boolean;
  provenance: SlimProvenance | GetClassStructureSuccess['provenance'];
  /** Always present: declared method names (overview-level). */
  declaredMethodNames: string[];
  /** Present when scope=declared/effective or include has 'signatures'/'all'. */
  declaredMethods?: ProjectedMethodEntry[];
  /** Present when scope=declared/effective or include has 'fields'. */
  fields?: ProjectedFieldEntry[];
  /** Present when scope=effective or include has 'inherited'/'all'. */
  inheritedMethods?: ProjectedMethodEntry[];
  typeHierarchy?: GetClassStructureSuccess['typeHierarchy'];
  classAnnotations?: GetClassStructureSuccess['classAnnotations'];
};

function projectMethod(m: ClassStructureMethod, sourceAvailable: boolean): ProjectedMethodEntry {
  const row: ProjectedMethodEntry = {
    name: m.name,
    declaringClass: m.declaringClass,
    visibility: m.visibility,
    returnType: m.returnType,
    parameters: m.parameters,
    typeParameters: m.typeParameters,
    throws: m.throws,
    abstract: m.abstract,
    static: m.static,
  };
  if (m.javadoc != null) {
    row.javadoc = m.javadoc;
  }
  if (m.annotations) {
    row.annotations = m.annotations;
  }
  // Omit synthetic jvmDescriptor when source-parsed
  if (!sourceAvailable || !isSyntheticJvmDescriptor(m.jvmDescriptor)) {
    row.jvmDescriptor = m.jvmDescriptor;
  }
  if (m.genericSignature != null) {
    row.genericSignature = m.genericSignature;
  }
  return row;
}

/**
 * Project a GetClassStructureSuccess into a slim JSON payload for full=true MCP responses.
 * Scope and include together control which sections are populated.
 */
export function projectClassStructure(
  result: GetClassStructureSuccess,
  opts: {
    scope?: ClassStructureScope;
    include?: ClassStructureIncludeSection[];
  } = {},
): ProjectedClassStructure {
  const { scope, include } = opts;
  const wantsFullProvenance = wantsSection(include, 'provenance');

  const declared = result.methods.filter((m) => !m.inherited);
  const inherited = result.methods.filter((m) => m.inherited);

  const projected: ProjectedClassStructure = {
    ok: true,
    className: result.className,
    kind: result.kind,
    superclass: result.superclass,
    interfaces: result.interfaces,
    typeParameters: result.typeParameters,
    sourceAvailable: result.sourceAvailable,
    provenance: wantsFullProvenance
      ? result.provenance
      : projectProvenance(result.provenance, include as string[] | undefined),
    declaredMethodNames: declared.map((m) => m.name),
  };

  const wantsSignatures = scopeImpliesSignatures(scope) || wantsSection(include, 'signatures');
  const wantsFields = scopeImpliesSignatures(scope) || wantsSection(include, 'fields');
  const wantsInherited = scopeImpliesInherited(scope) || wantsSection(include, 'inherited');

  if (wantsSignatures) {
    projected.declaredMethods = declared.map((m) => projectMethod(m, result.sourceAvailable));
  }
  if (wantsFields) {
    projected.fields = result.fields;
  }
  if (wantsInherited) {
    projected.inheritedMethods = inherited.map((m) => projectMethod(m, result.sourceAvailable));
  }

  if (result.typeHierarchy) {
    projected.typeHierarchy = result.typeHierarchy;
  }
  if (result.classAnnotations) {
    projected.classAnnotations = result.classAnnotations;
  }

  return projected;
}
