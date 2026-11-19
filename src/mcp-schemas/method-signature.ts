import * as z from 'zod';
import { classSourceErrorCodeSchema, classSourceErrorSchema, guidedFailureEnvelopeSchema, guidedNotFoundEnvelopeSchema, mcpErrorCategorySchema, outcomeOnlySuccessSchema, sourceLanguageSchema } from './common.js';
import { classStructureProvenanceSchema, javapOverloadSchema } from './javap.js';

export const mcpMethodSignatureFailureSchema = z.object({
  ok: z.literal(false),
  error: classSourceErrorSchema,
  code: classSourceErrorCodeSchema,
  errorCategory: mcpErrorCategorySchema,
  isRetryable: z.boolean(),
  ...guidedFailureEnvelopeSchema,
});

/** Documented MCP tool payloads for get_method_signature. */
export const mcpGetMethodSignaturePayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    /** false when the class exists but no overloads matched methodName (aligns with search/find). */
    found: z.boolean(),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    className: z.string(),
    methodName: z.string(),
    methodFound: z.boolean(),
    sourceAvailable: z.boolean(),
    sourceLanguage: sourceLanguageSchema.optional(),
    overloads: z.array(javapOverloadSchema),
    provenance: classStructureProvenanceSchema,
  }),
  z.object({
    ok: z.literal(true),
    found: z.literal(false),
    className: z.string(),
    methodName: z.string(),
    searchedArtifactCount: z.number(),
    querySucceeded: z.literal(true),
    code: z.literal('CLASS_NOT_FOUND'),
    suggestions: z.array(z.string()).optional(),
    suggestedModulePaths: z.array(z.string()).optional(),
    ...guidedNotFoundEnvelopeSchema,
  }),
  mcpMethodSignatureFailureSchema,
]);
