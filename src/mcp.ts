#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { getClassSource } from './get-class-source.js';
import { mergeSourceExcerptInputs } from './source-excerpt.js';
import {
  mcpToolResultFromClassSource,
  mcpToolResultFromFindInClassSource,
  mcpToolResultFromMethodSignature,
  mcpToolResultFromProjectRootError,
  mcpToolResultFromResolutionResult,
  mcpToolResultFromSearchClasses,
  mcpToolResultFromSearchInArtifact,
  mcpToolResultFromUnexpectedError,
  mcpToolResultFromClassStructure,
  type ClassSourceQueryContext,
  type ClassStructureQueryContext,
  type FindInClassSourceQueryContext,
  type MethodSignatureQueryContext,
  type SearchClassesQueryContext,
  type SearchInArtifactQueryContext,
} from './mcp-tool-result.js';
import { findInClassSource } from './find-in-class-source.js';
import { resolveProjectRoot } from './project-path.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import { UnsupportedProjectError } from './resolvers/index.js';
import { getClassStructure } from './get-class-structure.js';
import { getMethodSignaturesBytecode } from './get-method-signatures-bytecode.js';
import { getMethodSignatures } from './get-method-signatures.js';
import { searchClasses } from './search-classes.js';
import { searchInArtifact } from './search-in-artifact.js';
import { JVMSRC_INSTRUCTIONS, MCP_TOOL_COPY } from './copy/index.js';
import { withCallLog } from './diagnostics/call-log.js';

const artifactCoordinatesSchema = z.object({
  group: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

const provenanceSchema = z.union([
  z.object({
    kind: z.literal('sourcesJar'),
    coordinates: artifactCoordinatesSchema,
    jarPath: z.string(),
  }),
  z.object({
    kind: z.literal('decompiled'),
    coordinates: artifactCoordinatesSchema,
    jarPath: z.string(),
    entryRelPath: z.string(),
    cachePath: z.string(),
  }),
  z.object({
    kind: z.literal('interproject'),
    coordinates: artifactCoordinatesSchema,
    moduleName: z.string(),
    moduleRoot: z.string(),
    sourceRelativePath: z.string(),
    absoluteSourcePath: z.string(),
  }),
]);

const classSourceErrorSchema = z.discriminatedUnion('code', [
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

const mcpErrorCategorySchema = z.enum(['transient', 'validation', 'business', 'permission']);

/** Agent-directed guidance on failures and empty results (full=true). */
const guidedMessageSchema = { message: z.string() };

/** Happy-path success: no agent `message` (found/querySucceeded on each branch). */
const outcomeOnlySuccessSchema = {
  errorCategory: z.null(),
};

const guidedNotFoundEnvelopeSchema = {
  ...guidedMessageSchema,
  errorCategory: z.null(),
};

const guidedFailureEnvelopeSchema = {
  ...guidedMessageSchema,
  found: z.literal(false),
  querySucceeded: z.literal(false),
};

const classSourceErrorCodeSchema = z.enum([
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

const findInClassSourceHitSchema = z.object({
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

/** Agent-facing parameter docs. Keep each to one short sentence: they are sent to the model on every turn. */
const D = {
  projectRoot: 'Project root. Omit to use the workspace.',
  modulePath: "Gradle path like ':app', or a file/dir inside the module. Omit (or \"*\") for all modules.",
  className: 'FQN, e.g. com.fasterxml.jackson.databind.ObjectMapper; a unique simple name works.',
  configuration: 'Gradle configuration (default compileClasspath).',
  includeTest: 'Use the test classpath.',
  forceRefresh: 'Bypass the resolution cache.',
  regex: 'Treat query as a regex.',
  contextLines: 'Context lines per hit.',
  maxHits: 'Max hits.',
} as const;

/** Names for one or more methods; a bare string is accepted for convenience. `<init>` = constructors. */
const methodNamesSchema = z.union([z.array(z.string().min(1)), z.string().min(1)]);

function methodNameList(v: string | string[] | undefined): string[] | undefined {
  return v === undefined ? undefined : typeof v === 'string' ? [v] : v;
}

/**
 * Inputs accepted but deliberately not advertised: `full` / `include` (JSON projection, for tests and
 * other tooling; agents get compact text) and the legacy singular `methodName`.
 */
function hiddenArgs(args: object): { full?: boolean; include?: string[]; methodName?: string } {
  const a = args as Record<string, unknown>;
  return {
    full: typeof a.full === 'boolean' ? a.full : undefined,
    include: Array.isArray(a.include) ? a.include.filter((x): x is string => typeof x === 'string') : undefined,
    methodName: typeof a.methodName === 'string' && a.methodName.length > 0 ? a.methodName : undefined,
  };
}

const findInClassSourceInputSchema = z.looseObject({
  className: z.string().min(1).describe(D.className),
  query: z.string().min(1).describe('Text to find in the class source (literal; regex if regex=true).'),
  projectRoot: z.string().optional().describe(D.projectRoot),
  modulePath: z.string().optional().describe(D.modulePath),
  configuration: z.string().optional().describe(D.configuration),
  includeTest: z.boolean().optional().describe(D.includeTest),
  forceRefresh: z.boolean().optional().describe(D.forceRefresh),
  contextLines: z.number().int().min(0).max(50).optional().describe(D.contextLines),
  maxHits: z.number().int().min(1).max(100).optional().describe(D.maxHits),
  regex: z.boolean().optional().describe(D.regex),
});

const getClassSourceInputSchema = z.looseObject({
  className: z.string().min(1).describe(D.className),
  methodNames: methodNamesSchema
    .optional()
    .describe('Only these methods ("<init>" = constructors), all overloads. Omit for the whole class.'),
  projectRoot: z.string().optional().describe(D.projectRoot),
  modulePath: z.string().optional().describe(D.modulePath),
  configuration: z.string().optional().describe(D.configuration),
  includeTest: z.boolean().optional().describe(D.includeTest),
  forceRefresh: z.boolean().optional().describe(D.forceRefresh),
  startLine: z.number().int().positive().optional().describe('First line (1-based); needs endLine.'),
  endLine: z.number().int().positive().optional().describe('Last line; needs startLine.'),
});

const buildSystemInfoSchema = z.object({
  type: z.literal('gradle'),
  version: z.string(),
  wrapper: z.boolean(),
});

const resolutionErrorSchema = z.object({
  module: z.string(),
  configuration: z.string().optional(),
  message: z.string(),
  fatal: z.boolean(),
});

/** Top-level ResolutionOutput shape (§5.5.2); nested modules validated at Gradle/cache boundary. */
const resolutionOutputSchema = z.object({
  schemaVersion: z.string(),
  resolvedAt: z.string(),
  buildSystem: buildSystemInfoSchema,
  projectRoot: z.string(),
  modules: z.array(z.unknown()),
  errors: z.array(resolutionErrorSchema),
});

const listModulesConfigurationRowSchema = z.object({
  name: z.string(),
  scope: z.enum(['compile', 'runtime', 'test-compile', 'test-runtime']),
  artifactCount: z.number(),
  directArtifactCount: z.number(),
});

const listModulesModuleRowSchema = z.object({
  name: z.string(),
  path: z.string(),
  configurations: z.array(listModulesConfigurationRowSchema),
});

const resolveDependenciesFailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.literal('RESOLUTION_FAILED'),
    message: z.string(),
    stderr: z.string().optional(),
  }),
  code: z.literal('RESOLUTION_FAILED'),
  errorCategory: mcpErrorCategorySchema,
  isRetryable: z.boolean(),
  ...guidedFailureEnvelopeSchema,
});

/** Documented MCP tool payloads for resolve_dependencies (success or categorized failure). */
export const mcpResolveDependenciesPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    resolution: resolutionOutputSchema,
  }),
  resolveDependenciesFailureSchema,
]);

export const mcpListModulesPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    projectRoot: z.string(),
    resolvedAt: z.string(),
    schemaVersion: z.string(),
    buildSystem: buildSystemInfoSchema,
    modules: z.array(listModulesModuleRowSchema),
    resolutionWarningCount: z.number(),
  }),
  resolveDependenciesFailureSchema,
]);

const classSearchIndexMetaSchema = z.object({
  indexFormatVersion: z.literal(3),
  buildInputsDigest: z.string(),
  resolutionFingerprint: z.string(),
  moduleName: z.string(),
  configurationName: z.string(),
  includeTest: z.boolean(),
  builtAt: z.string(),
  entryCount: z.number(),
  skippedArtifacts: z.number(),
  sourceEnrichedEntries: z.number(),
  sourceEnrichmentBytesCap: z.number(),
});

const searchClassesHitSchema = z
  .object({
    className: z.string(),
    libName: z.string(),
    simpleName: z.string().optional(),
    score: z.number().optional(),
    origin: z.enum(['external', 'interproject', 'local-file']).optional(),
    coordinates: artifactCoordinatesSchema.optional(),
    jarPath: z.string().nullable().optional(),
    moduleRoot: z.string().nullable().optional(),
    interprojectModuleName: z.string().nullable().optional(),
    moduleName: z.string().optional(),
    configurationName: z.string().optional(),
  })
  .passthrough();

export const mcpSearchClassesPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.boolean(),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    query: z.string(),
    limit: z.number(),
    totalMatches: z.number(),
    hitCount: z.number(),
    hits: z.array(searchClassesHitSchema),
    indexMeta: classSearchIndexMetaSchema.optional(),
  }),
  resolveDependenciesFailureSchema,
]);

const searchClassesInputSchema = z.looseObject({
  query: z.string().min(1).describe('Case-insensitive substring; words are AND-ed; * ? globs.'),
  projectRoot: z.string().optional().describe(D.projectRoot),
  modulePath: z.string().optional().describe(D.modulePath),
  configuration: z.string().optional().describe(D.configuration),
  includeTest: z.boolean().optional().describe(D.includeTest),
  forceRefresh: z.boolean().optional().describe(D.forceRefresh),
  limit: z.number().int().positive().max(200).optional().describe('Maximum hits (default 50).'),
});

const resolveDependenciesInputSchema = z.looseObject({
  query: z
    .string()
    .optional()
    .describe('Library filter, e.g. "jackson": lists matching artifact versions per module.'),
  projectRoot: z.string().optional().describe(D.projectRoot),
  forceRefresh: z.boolean().optional().describe(D.forceRefresh),
});

const javapParameterSchema = z.object({
  name: z.string().nullable(),
  typeDisplay: z.string(),
});

/** Full javap row or IDE-minimal row (source-first path omits bytecode-only fields). */
const javapOverloadSchema = z.object({
  declarationLine: z.string(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  jvmDescriptor: z.string().optional(),
  genericSignature: z.string().nullable().optional(),
  returnTypeDisplay: z.string().nullable(),
  parameters: z.array(javapParameterSchema),
  thrownExceptions: z.array(z.string()),
  flagsLine: z.string().nullable().optional(),
});

const classpathJarProvenanceSchema = z.object({
  kind: z.literal('classpathJar'),
  coordinates: artifactCoordinatesSchema,
  jarPath: z.string(),
});

const interprojectBytecodeProvenanceSchema = z.object({
  kind: z.literal('interprojectBytecode'),
  coordinates: artifactCoordinatesSchema,
  moduleName: z.string(),
  moduleRoot: z.string(),
  classpathRoot: z.string(),
});

const sourcesJarStructureProvenanceSchema = z.object({
  kind: z.literal('sourcesJar'),
  coordinates: artifactCoordinatesSchema,
  jarPath: z.string(),
});

const interprojectSourceProvenanceSchema = z.object({
  kind: z.literal('interprojectSource'),
  coordinates: artifactCoordinatesSchema,
  moduleName: z.string(),
  moduleRoot: z.string(),
  absoluteSourcePath: z.string(),
  sourceRelativePath: z.string(),
});

const classStructureProvenanceSchema = z.union([
  classpathJarProvenanceSchema,
  interprojectBytecodeProvenanceSchema,
  sourcesJarStructureProvenanceSchema,
  interprojectSourceProvenanceSchema,
]);

const getMethodSignatureInputSchema = z
  .looseObject({
    className: z.string().min(1).describe(D.className),
    methodNames: methodNamesSchema
      .optional()
      .describe('Method name(s) ("<init>" = constructors). Required.'),
    projectRoot: z.string().optional().describe(D.projectRoot),
    modulePath: z.string().optional().describe(D.modulePath),
    configuration: z.string().optional().describe(D.configuration),
    includeTest: z.boolean().optional().describe(D.includeTest),
    forceRefresh: z.boolean().optional().describe(D.forceRefresh),
    bytecodeOnly: z.boolean().optional().describe('Skip sources; read bytecode only.'),
  })
  .refine((v) => (methodNameList(v.methodNames)?.length ?? 0) > 0 || hiddenArgs(v).methodName !== undefined, {
    message: 'Provide methodNames, e.g. ["findById"] ("<init>" for constructors).',
    path: ['methodNames'],
  });

const mcpMethodSignatureFailureSchema = z.object({
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

const classStructureKindSchema = z.enum(['class', 'interface', 'enum', 'annotation', 'record']);

const classStructureParameterSchema = z.object({
  name: z.string().nullable(),
  type: z.string(),
});

const classStructureDeclaredAnnotationSchema = z.object({
  summary: z.string(),
});

const classStructureMethodSchema = z.object({
  name: z.string(),
  jvmMethodName: z.string(),
  declaringClass: z.string(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  returnType: z.string(),
  parameters: z.array(classStructureParameterSchema),
  typeParameters: z.array(z.string()),
  javadoc: z.string().nullable(),
  abstract: z.boolean(),
  static: z.boolean(),
  throws: z.array(z.string()),
  genericSignature: z.string().nullable(),
  jvmDescriptor: z.union([z.string(), z.null()]),
  inherited: z.boolean(),
  annotations: z.array(classStructureDeclaredAnnotationSchema).optional(),
});

const classStructureFieldSchema = z.object({
  name: z.string(),
  declaringClass: z.string(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  type: z.string(),
  static: z.boolean(),
  final: z.boolean(),
  enumConstant: z.boolean(),
  javadoc: z.string().nullable(),
  annotations: z.array(classStructureDeclaredAnnotationSchema).optional(),
});

const classStructureTypeHierarchySchema = z.object({
  superclassChain: z.array(
    z.object({
      className: z.string(),
      kind: classStructureKindSchema,
    }),
  ),
  allSuperinterfaces: z.array(z.string()),
});

const classStructureScopeSchema = z.enum(['overview', 'declared', 'effective']);

const getClassStructureInputSchema = z.looseObject({
  className: z.string().min(1).describe(D.className),
  scope: classStructureScopeSchema
    .optional()
    .describe('overview (default): purpose + method names; declared: all signatures; effective: + inherited.'),
  projectRoot: z.string().optional().describe(D.projectRoot),
  modulePath: z.string().optional().describe(D.modulePath),
  configuration: z.string().optional().describe(D.configuration),
  includeTest: z.boolean().optional().describe(D.includeTest),
  forceRefresh: z.boolean().optional().describe(D.forceRefresh),
});

const mcpClassStructureFailureSchema = z.object({
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
    interfaces: z.array(z.string()),
    typeParameters: z.array(z.string()),
    fields: z.array(classStructureFieldSchema),
    methods: z.array(classStructureMethodSchema),
    sourceAvailable: z.boolean(),
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

const searchInArtifactInputSchema = z
  .looseObject({
    query: z.string().min(1).describe('Text to find in the JAR\'s classes (literal; regex if regex=true).'),
    coordinates: z
      .object({
        group: z.string().min(1),
        name: z.string().min(1),
        version: z.string().nullable().optional(),
      })
      .optional()
      .describe('Dependency to search, as listed by resolve_dependencies.'),
    jarPath: z.string().optional().describe('Absolute JAR path (instead of coordinates).'),
    projectRoot: z.string().optional().describe(D.projectRoot),
    modulePath: z.string().optional().describe(D.modulePath),
    configuration: z.string().optional().describe(D.configuration),
    includeTest: z.boolean().optional().describe(D.includeTest),
    forceRefresh: z.boolean().optional().describe(D.forceRefresh),
    regex: z.boolean().optional().describe(D.regex),
    contextLines: z.number().int().min(0).max(50).optional().describe(D.contextLines),
    maxHits: z.number().int().min(1).max(100).optional().describe(D.maxHits),
    maxClasses: z.number().int().min(1).max(500).optional().describe('Maximum classes to scan.'),
  })
  .refine((v) => v.coordinates !== undefined || v.jarPath !== undefined, {
    message: 'At least one of coordinates or jarPath must be provided.',
  });

/** One result per requested method: a single result passes through; several are joined as text (errors win `isError`). */
function combineToolResults(results: CallToolResult[]): CallToolResult {
  if (results.length === 1) {
    return results[0]!;
  }
  const text = results
    .map((r) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'))
    .join('\n\n');
  return { isError: results.some((r) => r.isError), content: [{ type: 'text', text }] };
}

/** Workspace folders the client announced via MCP `roots`; empty when unsupported or on error. */
async function listWorkspaceRoots(server: McpServer): Promise<string[]> {
  if (!server.server.getClientCapabilities()?.roots) {
    return [];
  }
  try {
    const { roots } = await server.server.listRoots();
    return roots
      .map((r) => r.uri)
      .filter((u) => u.startsWith('file:'))
      .map((u) => fileURLToPath(u));
  } catch {
    return [];
  }
}

/** Builds the MCP server with all tools registered; no transport attached. */
export function createMcpServer(): McpServer {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };

  const server = new McpServer(
    { name: 'jvmsrc', version: pkg.version ?? '0.0.0' },
    {
      instructions: JVMSRC_INSTRUCTIONS
    },
  );

  const locateProjectRoot = async (requested: string | undefined) => {
    let workspaceRoots: string[] = [];
    if (!requested?.trim() || !path.isAbsolute(requested.trim())) {
      workspaceRoots = await listWorkspaceRoots(server);
    }
    return resolveProjectRoot(requested, { workspaceRoots });
  };

  const registerTool = server.registerTool.bind(server) as typeof server.registerTool;
  server.registerTool = ((name: string, config: never, cb: never) =>
    registerTool(name, config, withCallLog(name, cb) as never)) as typeof server.registerTool;

  server.registerTool(
    'get_class_source',
    {
      title: MCP_TOOL_COPY.get_class_source.title,
      description: MCP_TOOL_COPY.get_class_source.description,
      inputSchema: getClassSourceInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      const query: ClassSourceQueryContext = {
        projectRoot: root.path,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        full: hidden.full,
      };

      try {
        const methodNames = mergeSourceExcerptInputs(methodNameList(args.methodNames), hidden.methodName);
        const result = await getClassSource(args.className, {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
          excerpt:
            methodNames !== undefined || args.startLine !== undefined || args.endLine !== undefined
              ? {
                  methodNames,
                  startLine: args.startLine,
                  endLine: args.endLine,
                }
              : undefined,
        });
        return mcpToolResultFromClassSource(result, query);
      } catch (e) {
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'find_in_class_source',
    {
      title: MCP_TOOL_COPY.find_in_class_source.title,
      description: MCP_TOOL_COPY.find_in_class_source.description,
      inputSchema: findInClassSourceInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      const query: FindInClassSourceQueryContext = {
        projectRoot: root.path,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        query: args.query,
        regex: args.regex,
        full: hidden.full,
        include: hidden.include as never,
      };

      try {
        const result = await findInClassSource(args.className, {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
          query: args.query,
          contextLines: args.contextLines,
          maxHits: args.maxHits,
          regex: Boolean(args.regex),
        });
        return mcpToolResultFromFindInClassSource(result, query);
      } catch (e) {
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'resolve_dependencies',
    {
      title: MCP_TOOL_COPY.resolve_dependencies.title,
      description: MCP_TOOL_COPY.resolve_dependencies.description,
      inputSchema: resolveDependenciesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      try {
        const result = await resolveWithResolutionCache(root.path, {
          forceRefresh: Boolean(args.forceRefresh),
          diagnosticOperation: 'resolve_dependencies',
        });
        return mcpToolResultFromResolutionResult(result, root.path, hidden.full, hidden.include as never, args.query);
      } catch (e) {
        if (e instanceof UnsupportedProjectError) {
          return mcpToolResultFromProjectRootError(e.message, root.path);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'search_classes',
    {
      title: MCP_TOOL_COPY.search_classes.title,
      description: MCP_TOOL_COPY.search_classes.description,
      inputSchema: searchClassesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      const queryCtx: SearchClassesQueryContext = {
        projectRoot: root.path,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        query: args.query,
        full: hidden.full,
        include: hidden.include as never,
      };

      try {
        const result = await searchClasses({
          projectRoot: root.path,
          query: args.query,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
          limit: args.limit,
        });
        return mcpToolResultFromSearchClasses(result, queryCtx);
      } catch (e) {
        if (e instanceof UnsupportedProjectError) {
          return mcpToolResultFromProjectRootError(e.message, root.path);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'get_method_signature',
    {
      title: MCP_TOOL_COPY.get_method_signature.title,
      description: MCP_TOOL_COPY.get_method_signature.description,
      inputSchema: getMethodSignatureInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      const methodNames = mergeSourceExcerptInputs(methodNameList(args.methodNames), hidden.methodName) ?? [];

      try {
        const opts = {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
        };
        const results: CallToolResult[] = [];
        for (const methodName of methodNames) {
          const query: MethodSignatureQueryContext = {
            projectRoot: root.path,
            modulePath: args.modulePath,
            configuration: args.configuration,
            includeTest: args.includeTest,
            methodName,
            full: hidden.full,
            include: hidden.include as never,
          };
          const result = Boolean(args.bytecodeOnly)
            ? await getMethodSignaturesBytecode(args.className, methodName, opts)
            : await getMethodSignatures(args.className, methodName, opts);
          results.push(mcpToolResultFromMethodSignature(result, query));
        }
        return combineToolResults(results);
      } catch (e) {
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'get_class_structure',
    {
      title: MCP_TOOL_COPY.get_class_structure.title,
      description: MCP_TOOL_COPY.get_class_structure.description,
      inputSchema: getClassStructureInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      const query: ClassStructureQueryContext = {
        projectRoot: root.path,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        full: hidden.full,
        scope: args.scope,
        include: hidden.include as ClassStructureQueryContext['include'],
      };

      try {
        const coreInclude = (hidden.include ?? []).filter(
          (s): s is 'hierarchy' | 'fields' | 'annotations' =>
            s === 'hierarchy' || s === 'fields' || s === 'annotations',
        );
        const result = await getClassStructure(args.className, {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
          include: coreInclude.length > 0 ? coreInclude : undefined,
          scope: args.scope,
        });
        return mcpToolResultFromClassStructure(result, query);
      } catch (e) {
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'search_in_artifact',
    {
      title: MCP_TOOL_COPY.search_in_artifact.title,
      description: MCP_TOOL_COPY.search_in_artifact.description,
      inputSchema: searchInArtifactInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      const hidden = hiddenArgs(args);

      const query: SearchInArtifactQueryContext = {
        projectRoot: root.path,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        full: hidden.full,
      };

      try {
        const result = await searchInArtifact({
          projectRoot: root.path,
          selector: {
            coordinates: args.coordinates
              ? { group: args.coordinates.group, name: args.coordinates.name, version: args.coordinates.version }
              : undefined,
            jarPath: args.jarPath,
          },
          query: args.query,
          regex: Boolean(args.regex),
          contextLines: args.contextLines,
          maxHits: args.maxHits,
          maxClasses: args.maxClasses,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
        });
        return mcpToolResultFromSearchInArtifact(result, query);
      } catch (e) {
        if (e instanceof UnsupportedProjectError) {
          return mcpToolResultFromProjectRootError(e.message, root.path);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
