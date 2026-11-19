import * as z from 'zod';
import { classSourceErrorCodeSchema, classSourceErrorSchema, guidedFailureEnvelopeSchema, guidedNotFoundEnvelopeSchema, mcpErrorCategorySchema, outcomeOnlySuccessSchema, provenanceSchema, sourceLanguageSchema } from './common.js';

/**
 * Documented MCP tool payloads (success, not-found, or categorized failure).
 * Used in tests and agent docs only — not passed as MCP `outputSchema`: the SDK's
 * output validator only accepts object schemas; `z.union` triggers a runtime `_zod` crash.
 */
export const mcpClassSourceToolPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    source: z.string(),
    sourceAvailable: z.boolean(),
    sourceLanguage: sourceLanguageSchema,
    className: z.string(),
    provenance: provenanceSchema,
    excerpt: z
      .object({
        excerpted: z.literal(true),
        requestedMethodNames: z.array(z.string()),
        matchedMethodNames: z.array(z.string()),
        unmatchedMethodNames: z.array(z.string()),
        startLine: z.number().optional(),
        endLine: z.number().optional(),
        lineNumbersReliable: z.boolean(),
        sourceLineCount: z.number(),
        inheritedExcerpts: z
          .array(z.object({ methodName: z.string(), declaringClass: z.string() }))
          .optional(),
      })
      .optional(),
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
  z.object({
    ok: z.literal(false),
    error: classSourceErrorSchema,
    code: classSourceErrorCodeSchema,
    errorCategory: mcpErrorCategorySchema,
    isRetryable: z.boolean(),
    ...guidedFailureEnvelopeSchema,
  }),
]);

export const findInClassSourceHitSchema = z.object({
  line: z.number(),
  column: z.number(),
  matchedText: z.string(),
  block: z.object({ startLine: z.number(), endLine: z.number() }).optional(),
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
});

/** Documented MCP payloads for find_in_class_source (tests / agent docs). */
export const mcpFindInClassSourcePayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    className: z.string(),
    query: z.string(),
    regex: z.boolean(),
    sourceAvailable: z.boolean(),
    provenance: provenanceSchema,
    lineNumbersReliable: z.boolean(),
    totalMatches: z.number(),
    hitCount: z.number(),
    truncated: z.boolean(),
    hits: z.array(findInClassSourceHitSchema),
  }),
  z.object({
    ok: z.literal(true),
    found: z.literal(false),
    querySucceeded: z.literal(true),
    className: z.string(),
    query: z.string(),
    regex: z.boolean(),
    sourceAvailable: z.boolean(),
    provenance: provenanceSchema,
    ...guidedNotFoundEnvelopeSchema,
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
  z.object({
    ok: z.literal(false),
    error: classSourceErrorSchema,
    code: classSourceErrorCodeSchema,
    errorCategory: mcpErrorCategorySchema,
    isRetryable: z.boolean(),
    ...guidedFailureEnvelopeSchema,
  }),
]);
