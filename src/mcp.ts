#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
  mcpToolResultFromUnexpectedError,
  mcpToolResultFromClassStructure,
  type ClassSourceQueryContext,
  type ClassStructureQueryContext,
  type FindInClassSourceQueryContext,
  type MethodSignatureQueryContext,
  type SearchClassesQueryContext,
} from './mcp-tool-result.js';
import { findInClassSource } from './find-in-class-source.js';
import { resolveProjectRoot } from './project-path.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import { UnsupportedProjectError } from './resolvers/index.js';
import { getClassStructure } from './get-class-structure.js';
import { getMethodSignaturesBytecode } from './get-method-signatures-bytecode.js';
import { getMethodSignatures } from './get-method-signatures.js';
import { searchClasses } from './search-classes.js';

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
  z.object({ code: z.literal('MODULE_NOT_FOUND'), message: z.string(), modulePath: z.string() }),
  z.object({
    code: z.literal('CONFIGURATION_NOT_FOUND'),
    message: z.string(),
    moduleName: z.string(),
    configuration: z.string(),
  }),
  z.object({
    code: z.literal('CLASS_NOT_FOUND'),
    message: z.string(),
    className: z.string(),
    searchedArtifactCount: z.number(),
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

const fullResponseInput = { full: z.boolean().optional() };

const findInClassSourceInputSchema = z.object({
  className: z.string().min(1),
  projectRoot: z.string().min(1),
  query: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  contextLines: z.number().int().min(0).max(50).optional(),
  maxHits: z.number().int().min(1).max(100).optional(),
  regex: z.boolean().optional(),
  ...fullResponseInput,
});

const getClassSourceInputSchema = z.object({
  className: z.string().min(1),
  projectRoot: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  /** Return only these methods/constructors (`<init>` for constructors). Multiple overloads are all included. */
  methodNames: z.array(z.string().min(1)).optional(),
  /** Convenience when a single method is needed; merged with `methodNames`. */
  methodName: z.string().min(1).optional(),
  /** 1-based inclusive line range in the full compilation unit (combine with `methodNames`). */
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  ...fullResponseInput,
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

const searchClassesHitSchema = z.object({
  className: z.string(),
  simpleName: z.string(),
  moduleName: z.string(),
  configurationName: z.string(),
  origin: z.enum(['external', 'interproject', 'local-file']),
  coordinates: artifactCoordinatesSchema,
  jarPath: z.string().nullable(),
  moduleRoot: z.string().nullable(),
  interprojectModuleName: z.string().nullable(),
  score: z.number(),
});

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
    indexMeta: classSearchIndexMetaSchema,
  }),
  resolveDependenciesFailureSchema,
]);

const searchClassesInputSchema = z.object({
  query: z.string().min(1),
  projectRoot: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional(),
  ...fullResponseInput,
});

const resolveDependenciesInputSchema = z.object({
  projectRoot: z.string().min(1),
  forceRefresh: z.boolean().optional(),
  ...fullResponseInput,
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

const getMethodSignatureInputSchema = z.object({
  className: z.string().min(1),
  methodName: z.string().min(1),
  projectRoot: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  /** When true: javap -private -verbose only (no sources JAR or src/ fallback). Default false = IDE-first. */
  bytecodeOnly: z.boolean().optional(),
  ...fullResponseInput,
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
    found: z.literal(true),
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

const classStructureScopeSchema = z.enum(['overview', 'declared', 'effective', 'full']);

const getClassStructureInputSchema = z.object({
  className: z.string().min(1),
  projectRoot: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  include: z.array(z.enum(['hierarchy', 'fields', 'annotations'])).optional(),
  /** Compact text detail: overview (default), declared, effective. Use full=true for JSON. */
  scope: classStructureScopeSchema.optional(),
  ...fullResponseInput,
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
    ...guidedNotFoundEnvelopeSchema,
  }),
  mcpClassStructureFailureSchema,
]);

const JVMSRC_INSTRUCTIONS = `
jvmsrc inspects external JVM dependencies — libraries and modules that are on the
project's classpath but are NOT part of its own source tree. For local classes
(anything under src/), use standard tools: grep, glob, bash, file search.

The boundary:
- External dependency (in a JAR, resolved by Gradle) → jvmsrc, always
- Local source file (lives under src/ in this repo)  → grep/glob/bash, never jvmsrc

Why this matters: the global Gradle cache holds many versions of every library.
Only jvmsrc resolves the exact version this project uses. Manual JAR inspection
(javap, unzip, jar, cache browsing) silently picks the wrong one. There is no
fallback: if jvmsrc fails, surface the error — do not substitute manual inspection.

When to reach for jvmsrc:
- Understanding an external class, interface, or annotation
- Finding which dependency provides a type (unknown FQN or simple name)
- Verifying a method signature, overloads, or return type from a library
- Inspecting inherited behavior from an external superclass
- Debugging ClassCastException, NoSuchMethodError, or version mismatch

Scope: Gradle projects only. projectRoot = directory containing gradlew.

## Tool Selection — Narrowest First

1. search_classes                          — unknown FQN or simple name
2. get_class_structure scope: overview     — purpose + method names (start here)
3. get_method_signature                    — one method's overloads
4. get_class_structure scope: declared     — signature lines for many members
5. find_in_class_source                    — needle in a known class
6. get_class_source with methodNames/range — method bodies
7. get_class_source full / full: true      — last resort only

Anti-patterns:
- Globbing **/Foo.java for external types — they live in JARs, not source trees
- Full get_class_source to discover method names → use get_class_structure overview
- full: true by default → compact text is enough; only use when parsing JSON
- resolve_dependencies full: true for module names → default text summary suffices

## Response Format

Plain text by default. Never pass full: true unless parsing JSON programmatically.

Failures and empty results include agent-directed guidance:
- full=true: read structuredContent.message (also found, querySucceeded, errorCategory).
- compact (default): same fields in a --- footer after the payload text.
Happy-path successes return payload text only (no message footer); full=true JSON includes found, querySucceeded, errorCategory: null.

If outputTruncated is true, use methodNames excerpts or get_class_structure —
do not assume missing code is absent.

## modulePath

Pass modulePath (e.g. ":app") when scoping to one submodule — from settings.gradle
or resolve_dependencies → resolution.modules[].name. Omit for single-module projects.
Without it, all modules are searched and version conflicts across modules are surfaced.

## sourceAvailable

- true  — original source; Javadoc, parameter names, generics are ground truth
- false — CFR decompilation; structure reliable, names may be synthetic (arg0) —
          confirm with get_method_signature if parameter names matter

Never invent signatures after a tool returned the real ones.

## Session Cache

Cache projectRoot and modulePath once per session. First call invokes Gradle (5–10s);
subsequent calls reuse cache (<100ms). Use forceRefresh: true only for SNAPSHOT
republish or manual cache wipe — not routinely.

## Debugging

| Symptom                                 | Action                                          |
|-----------------------------------------|-------------------------------------------------|
| NoSuchMethodError / AbstractMethodError | resolve_dependencies — version mismatch         |
| ClassCastException across libs          | resolve_dependencies — duplicate coordinates    |
| Unexpected runtime behavior             | get_class_source excerpt; check sourceAvailable |
| Unfamiliar class in stack trace         | search_classes → get_class_structure            |
| Stale SNAPSHOT / after cache wipe       | resolve_dependencies(forceRefresh: true)        |

## Excerpt Edge Cases

- methodNames: use <init> for constructors; response includes matchedMethodNames /
  unmatchedMethodNames
- find_in_class_source: found: false + querySucceeded: true — pattern absent, not a
  search_classes substitute
- EXCERPT_NOT_FOUND / EXCERPT_REQUEST_INVALID — fix methodNames or line range

## Errors

On failures and empty results, read message — it explains what happened and the next tool call to try.
errorCategory transient: retry once; validation: fix inputs; permission: escalate credentials.
found:false with querySucceeded:true is a successful scan with no match (not isError).
`;

export async function startMcpServer(): Promise<void> {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };

  const server = new McpServer(
    { name: 'jvmsrc', version: pkg.version ?? '0.0.0' },
    {
      instructions: JVMSRC_INSTRUCTIONS
    },
  );

  server.registerTool(
    'get_class_source',
    {
      title: 'Get Java source for a class',
      description:
        'Resolves the project classpath (cached), then returns Java source for a fully-qualified class name. ' +
        'Optional excerpt: methodNames (array; use <init> for constructors), and/or startLine/endLine (1-based) to avoid full-file payloads. ' +
        'Agent usage: last resort for bodies; use methodNames excerpt first. Default compact=text source + provenance footer; full=true for JSON envelope. ' +
        'On failure: isError=true with errorCategory, isRetryable, message, and stable code (§7). ' +
        'When the class is absent from a successfully resolved classpath: isError=false, found=false (do not treat as access failure).',
      inputSchema: getClassSourceInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: ClassSourceQueryContext = {
        projectRoot: args.projectRoot,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        full: args.full,
      };

      const root = resolveProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot);
      }

      try {
        const methodNames = mergeSourceExcerptInputs(args.methodNames, args.methodName);
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
      title: 'Find text in resolved Java source',
      description:
        'Resolves classpath source for a fully-qualified class (same as get_class_source), then searches for a literal ' +
        'substring or regex. Returns hits with line/column, matched text, optional multiline block, and context lines. ' +
        'Agent usage: when class is known and you need a needle — not workspace grep. Default compact=text hits; full=true for JSON. ' +
        'When the class is missing from the classpath: isError=false, found=false (CLASS_NOT_FOUND). ' +
        'When the class exists but nothing matches: isError=false, found=false, querySucceeded=true.',
      inputSchema: findInClassSourceInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: FindInClassSourceQueryContext = {
        projectRoot: args.projectRoot,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        query: args.query,
        regex: args.regex,
        full: args.full,
      };

      const root = resolveProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot);
      }

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
      title: 'Resolve Gradle dependencies',
      description:
        'Runs or loads cached Gradle dependency resolution for the project and returns ResolutionOutput (§5.5.2). ' +
        'Agent usage: compact text module/config summary by default; full=true only for full artifact JSON. ' +
        'Use forceRefresh to bypass the hash cache after dependency changes without build-file edits. ' +
        'On failure: isError=true with errorCategory, isRetryable, message, and code RESOLUTION_FAILED.',
      inputSchema: resolveDependenciesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = resolveProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot);
      }

      try {
        const result = await resolveWithResolutionCache(root.path, {
          forceRefresh: Boolean(args.forceRefresh),
          diagnosticOperation: 'resolve_dependencies',
        });
        return mcpToolResultFromResolutionResult(result, args.projectRoot, args.full);
      } catch (e) {
        if (e instanceof UnsupportedProjectError) {
          return mcpToolResultFromProjectRootError(e.message, args.projectRoot);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'search_classes',
    {
      title: 'Search classes on the resolved classpath',
      description:
        'Capability discovery when the FQN is unknown (SPEC §12.3): resolves or loads cached Gradle output, builds or reuses a disk index for the selected module + configuration, ' +
        'then returns ranked FQN hits. Query is a case-insensitive substring over the index `searchText` (FQN, simple name, and when sources exist: declared method/field identifiers and Javadoc plain text), or a glob with * and ? matched against FQN or simple name only. ' +
        'Agent usage: discovery only; follow with get_class_structure scope=overview — not full source. Default compact=text hit list; full=true for JSON. ' +
        'Optional limit (default 50, max 200). Same projectRoot, modulePath, configuration, includeTest, and forceRefresh semantics as get_class_source. ' +
        'On failure: isError=true with code RESOLUTION_FAILED or classpath validation codes.',
      inputSchema: searchClassesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const queryCtx: SearchClassesQueryContext = {
        projectRoot: args.projectRoot,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        query: args.query,
        full: args.full,
      };

      const root = resolveProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot);
      }

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
          return mcpToolResultFromProjectRootError(e.message, args.projectRoot);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'get_method_signature',
    {
      title: 'Get Java method overload signatures',
      description:
        'Overload listing (SPEC §7.2). Default (bytecodeOnly omitted or false): IDE-first — parse `.java` from sources JAR or inter-project src when present (sourceAvailable=true); else javap -private -verbose fallback (sourceAvailable=false). ' +
        'Agent usage: preferred for one method — do not use get_class_source for signatures. Default compact=declaration lines per overload; full=true for JSON. ' +
        'bytecodeOnly=true: javap only on the binary classpath element — no sources/src fallback; sourceAvailable always false (full JVM descriptors, flags, synthetic members). ' +
        'Use methodName <init> for constructors. CLASS_NOT_FOUND: isError=false, found=false. No matching overloads: methodFound=false.',
      inputSchema: getMethodSignatureInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: MethodSignatureQueryContext = {
        projectRoot: args.projectRoot,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        methodName: args.methodName,
        full: args.full,
      };

      const root = resolveProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot);
      }

      try {
        const opts = {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
        };
        const result = Boolean(args.bytecodeOnly)
          ? await getMethodSignaturesBytecode(args.className, args.methodName, opts)
          : await getMethodSignatures(args.className, args.methodName, opts);
        return mcpToolResultFromMethodSignature(result, query);
      } catch (e) {
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'get_class_structure',
    {
      title: 'Get structured Java class API',
      description:
        'Returns metadata for a fully-qualified class. Default compact=text with scope=overview (class purpose + declared method names). ' +
        'scope: overview | declared (signature lines) | effective (capped inherited API). full=true returns JSON (legacy shape). ' +
        'Agent usage: discovery → scope=overview; many signatures → scope=declared; one method → get_method_signature instead. ' +
        'Optional `include` for hierarchy/fields/annotations (mainly with full=true). Does not decompile (no CFR). On javap failure: SIGNATURE_EXTRACT_FAILED.',
      inputSchema: getClassStructureInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: ClassStructureQueryContext = {
        projectRoot: args.projectRoot,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
        full: args.full ?? (args.scope === 'full' ? true : undefined),
        scope: args.scope,
      };

      const root = resolveProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot);
      }

      try {
        const result = await getClassStructure(args.className, {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
          include: args.include,
          scope: args.scope === 'full' ? 'overview' : args.scope,
        });
        return mcpToolResultFromClassStructure(result, query);
      } catch (e) {
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
