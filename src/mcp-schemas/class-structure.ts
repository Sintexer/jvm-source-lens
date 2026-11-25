import * as z from 'zod';
import { classSourceErrorCodeSchema, classSourceErrorSchema, guidedFailureEnvelopeSchema, guidedNotFoundEnvelopeSchema, mcpErrorCategorySchema, outcomeOnlySuccessSchema, sourceLanguageSchema } from './common.js';
import { classStructureProvenanceSchema } from './javap.js';

export const classStructureKindSchema = z.enum(['class', 'interface', 'enum', 'annotation', 'record']);

export const classStructureParameterSchema = z.object({
  name: z.string().nullable(),
  type: z.string(),
});

export const classStructureDeclaredAnnotationSchema = z.object({
  summary: z.string(),
});

export const classStructureMethodSchema = z.object({
  name: z.string(),
  jvmMethodName: z.string(),
  declaringClass: z.string(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  returnType: z.string(),
  parameters: z.array(classStructureParameterSchema),
  typeParameters: z.array(z.string()),
  javadoc: z.string().nullable(),
  docsSource: z.literal('javadoc-jar').optional(),
  abstract: z.boolean(),
  static: z.boolean(),
  throws: z.array(z.string()),
  genericSignature: z.string().nullable(),
  jvmDescriptor: z.union([z.string(), z.null()]),
  inherited: z.boolean(),
  annotations: z.array(classStructureDeclaredAnnotationSchema).optional(),
});

export const classStructureFieldSchema = z.object({
  name: z.string(),
  declaringClass: z.string(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  type: z.string(),
  static: z.boolean(),
  final: z.boolean(),
  enumConstant: z.boolean(),
  javadoc: z.string().nullable(),
  docsSource: z.literal('javadoc-jar').optional(),
  annotations: z.array(classStructureDeclaredAnnotationSchema).optional(),
});

export const classStructureTypeHierarchySchema = z.object({
  superclassChain: z.array(
    z.object({
      className: z.string(),
      kind: classStructureKindSchema,
    }),
  ),
  allSuperinterfaces: z.array(z.string()),
});

export const classStructureScopeSchema = z.enum(['overview', 'declared', 'effective']);

export const mcpClassStructureFailureSchema = z.object({
  ok: z.literal(false),
  error: classSourceErrorSchema,
  code: classSourceErrorCodeSchema,
  errorCategory: mcpErrorCategorySchema,
  isRetryable: z.boolean(),
  ...guidedFailureEnvelopeSchema,
});

export const mcpGetClassStructurePayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    className: z.string(),
    kind: classStructureKindSchema,
    superclass: z.string().nullable(),
    classPurpose: z.string().nullable().optional(),
    docsSource: z.literal('javadoc-jar').optional(),
    interfaces: z.array(z.string()),
    typeParameters: z.array(z.string()),
    fields: z.array(classStructureFieldSchema),
    methods: z.array(classStructureMethodSchema),
    sourceAvailable: z.boolean(),
    sourceLanguage: sourceLanguageSchema.optional(),
    provenance: classStructureProvenanceSchema,
    typeHierarchy: classStructureTypeHierarchySchema.optional(),
    classAnnotations: z.array(classStructureDeclaredAnnotationSchema).optional(),
  }),
  z.object({
    ok: z.literal(true),
    found: z.literal(false),
    className: z.string(),
    searchedArtifactCount: z.number(),
    querySucceeded: z.literal(true),
    code: z.literal('CLASS_NOT_FOUND'),
    suggestions: z.array(z.string()).optional(),
    suggestedModulePaths: z.array(z.string()).optional(),
    ...guidedNotFoundEnvelopeSchema,
  }),
  mcpClassStructureFailureSchema,
]);
