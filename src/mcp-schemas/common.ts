import * as z from 'zod';

export const artifactCoordinatesSchema = z.object({
  group: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

export const provenanceSchema = z.union([
  z.object({
    kind: z.literal('sourcesJar'),
    coordinates: artifactCoordinatesSchema,
    jarPath: z.string(),
    nestedIn: z.string().optional(),
    sourceRelativePath: z.string().optional(),
  }),
  z.object({
    kind: z.literal('decompiled'),
    coordinates: artifactCoordinatesSchema,
    jarPath: z.string(),
    entryRelPath: z.string(),
    cachePath: z.string(),
    nestedIn: z.string().optional(),
  }),
  z.object({
    kind: z.literal('interproject'),
    coordinates: artifactCoordinatesSchema,
    moduleName: z.string(),
    moduleRoot: z.string(),
    sourceRelativePath: z.string(),
    absoluteSourcePath: z.string(),
    nestedIn: z.string().optional(),
  }),
]);

export const classSourceErrorSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('INVALID_FQN'), message: z.string() }),
  z.object({
    code: z.literal('MODULE_NOT_FOUND'),
    message: z.string(),
    modulePath: z.string(),
    availableModules: z.array(z.string()).optional(),
  }),
  z.object({
    code: z.literal('CONFIGURATION_NOT_FOUND'),
    message: z.string(),
    moduleName: z.string(),
    configuration: z.string(),
    availableModules: z.array(z.string()).optional(),
  }),
  z.object({
    code: z.literal('MODULE_AMBIGUOUS'),
    message: z.string(),
    modulePaths: z.array(z.string()),
    className: z.string().optional(),
  }),
  z.object({
    code: z.literal('CLASS_NOT_FOUND'),
    message: z.string(),
    className: z.string(),
    searchedArtifactCount: z.number(),
    suggestions: z.array(z.string()).optional(),
    suggestedModulePaths: z.array(z.string()).optional(),
  }),
  z.object({
    code: z.literal('DECOMPILE_FAILED'),
    message: z.string(),
    className: z.string(),
    jarPath: z.string(),
    entryRelPath: z.string(),
    coordinates: artifactCoordinatesSchema,
    stderr: z.string().optional(),
  }),
  z.object({
    code: z.literal('ZIP_READ_ERROR'),
    message: z.string(),
    jarPath: z.string(),
    entryRelPath: z.string().optional(),
  }),
  z.object({
    code: z.literal('RESOLUTION_FAILED'),
    message: z.string(),
    stderr: z.string().optional(),
  }),
  z.object({
    code: z.literal('SOURCES_RESOLVE_FAILED'),
    message: z.string(),
    coordinates: artifactCoordinatesSchema,
    stderr: z.string().optional(),
  }),
  z.object({
    code: z.literal('SIGNATURE_EXTRACT_FAILED'),
    message: z.string(),
    className: z.string(),
    methodName: z.string().optional(),
    jarPath: z.string(),
    stderr: z.string().optional(),
  }),
  z.object({
    code: z.literal('EXCERPT_REQUEST_INVALID'),
    message: z.string(),
  }),
  z.object({
    code: z.literal('EXCERPT_NOT_FOUND'),
    message: z.string(),
    className: z.string(),
    requestedMethodNames: z.array(z.string()),
    unmatchedMethodNames: z.array(z.string()),
  }),
  z.object({
    code: z.literal('FIND_QUERY_INVALID'),
    message: z.string(),
  }),
  z.object({
    code: z.literal('FIND_SOURCE_TOO_LARGE'),
    message: z.string(),
    byteLength: z.number(),
  }),
  z.object({
    code: z.literal('SOURCE_OUTPUT_TOO_LARGE'),
    message: z.string(),
    className: z.string(),
    charLength: z.number(),
    maxChars: z.number(),
  }),
]);

export const mcpErrorCategorySchema = z.enum(['transient', 'validation', 'business', 'permission']);

/** Agent-directed guidance on failures and empty results (full=true). */
export const guidedMessageSchema = { message: z.string() };

/** Happy-path success: no agent `message` (found/querySucceeded on each branch). */
export const outcomeOnlySuccessSchema = {
  errorCategory: z.null(),
};

export const guidedNotFoundEnvelopeSchema = {
  ...guidedMessageSchema,
  errorCategory: z.null(),
};

export const guidedFailureEnvelopeSchema = {
  ...guidedMessageSchema,
  found: z.literal(false),
  querySucceeded: z.literal(false),
};

export const sourceLanguageSchema = z.enum(['java', 'kotlin', 'scala', 'groovy']);

export const classSourceErrorCodeSchema = z.enum([
  'INVALID_FQN',
  'MODULE_NOT_FOUND',
  'CONFIGURATION_NOT_FOUND',
  'MODULE_AMBIGUOUS',
  'CLASS_NOT_FOUND',
  'DECOMPILE_FAILED',
  'ZIP_READ_ERROR',
  'RESOLUTION_FAILED',
  'SOURCES_RESOLVE_FAILED',
  'SIGNATURE_EXTRACT_FAILED',
  'EXCERPT_REQUEST_INVALID',
  'EXCERPT_NOT_FOUND',
  'FIND_QUERY_INVALID',
  'FIND_SOURCE_TOO_LARGE',
  'SOURCE_OUTPUT_TOO_LARGE',
]);
