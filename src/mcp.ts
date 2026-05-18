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
    description: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    error: classSourceErrorSchema,
    code: classSourceErrorCodeSchema,
    errorCategory: mcpErrorCategorySchema,
    isRetryable: z.boolean(),
    description: z.string(),
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
    description: z.string(),
  }),
  z.object({
    ok: z.literal(true),
    found: z.literal(false),
    className: z.string(),
    searchedArtifactCount: z.number(),
    querySucceeded: z.literal(true),
    code: z.literal('CLASS_NOT_FOUND'),
    description: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    error: classSourceErrorSchema,
    code: classSourceErrorCodeSchema,
    errorCategory: mcpErrorCategorySchema,
    isRetryable: z.boolean(),
    description: z.string(),
  }),
]);

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
  description: z.string(),
});

/** Documented MCP tool payloads for resolve_dependencies (success or categorized failure). */
export const mcpResolveDependenciesPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    resolution: resolutionOutputSchema,
  }),
  resolveDependenciesFailureSchema,
]);

export const mcpListModulesPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
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
    querySucceeded: z.literal(true),
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
});

const resolveDependenciesInputSchema = z.object({
  projectRoot: z.string().min(1),
  forceRefresh: z.boolean().optional(),
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
});

const mcpMethodSignatureFailureSchema = z.object({
  ok: z.literal(false),
  error: classSourceErrorSchema,
  code: classSourceErrorCodeSchema,
  errorCategory: mcpErrorCategorySchema,
  isRetryable: z.boolean(),
  description: z.string(),
});

/** Documented MCP tool payloads for get_method_signature. */
export const mcpGetMethodSignaturePayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
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
    description: z.string(),
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

const getClassStructureInputSchema = z.object({
  className: z.string().min(1),
  projectRoot: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  include: z.array(z.enum(['hierarchy', 'fields', 'annotations'])).optional(),
});

const mcpClassStructureFailureSchema = z.object({
  ok: z.literal(false),
  error: classSourceErrorSchema,
  code: classSourceErrorCodeSchema,
  errorCategory: mcpErrorCategorySchema,
  isRetryable: z.boolean(),
  description: z.string(),
});

export const mcpGetClassStructurePayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    querySucceeded: z.literal(true),
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
    description: z.string(),
  }),
  mcpClassStructureFailureSchema,
]);

const JVMSRC_INSTRUCTIONS = `
You have access to jvmsrc — JVM Source Lens. It resolves a project's exact classpath
by invoking the build tool, then extracts source or metadata for any class on that
classpath. The resolved version is always the one the project actually uses.
 
## Mandatory Rule
 
ALWAYS use jvmsrc tools for any JVM class or dependency task. NEVER:
- Manually locate or parse JARs under ~/.gradle, ~/.m2, or build output directories
- Run javap, unzip, or jar commands to inspect class contents
- Scan or grep build cache directories for artifact paths
- Infer signatures, method contracts, or type hierarchies from memory or training data
 
This rule is absolute. The global dependency cache holds multiple versions of every
library. Manual inspection silently picks the wrong one. Only jvmsrc knows which version
this project uses. If a tool fails, surface the error — do not fall back to manual inspection.

**Never use workspace file search instead of jvmsrc** for JVM types: do not glob \`**/Foo.java\`
under the repo or treat 0 hits as "class missing." Dependency classes live on the resolved
classpath (JARs), not as source files under the module you are editing. Simple name only →
\`search_classes\`; FQN from import → \`get_*\` directly. \`projectRoot\` = Gradle root (where gradlew lives).
 
## Tool Selection
 
Use the most specific tool for the task:
 
- Unknown FQN or simple class name (e.g. TradingMaskUtils) → \`search_classes\` on classpath — NOT \`**/Name.java\` in repo
- Method signature / overloads / exceptions → \`get_method_signature\` (default: source-first)
- Strict JVM descriptors, bridge or synthetic members → \`get_method_signature\` with \`bytecodeOnly: true\`
- API surface, hierarchy, fields, annotations → \`get_class_structure\`
- Full implementation body (only when needed) → \`get_class_source\` (use \`methodNames\` excerpt when possible)
- Needle inside a known class (log literal, throw message) → \`find_in_class_source\`
- Submodule names, dependency graph, version conflicts → \`resolve_dependencies\` (read \`resolution.modules[].name\`)

Prefer \`get_method_signature\` or \`get_class_structure\` over \`get_class_source\` —
they answer most questions at a fraction of the context cost.

Always pass \`projectRoot\` (absolute path). Pass \`modulePath\` (Gradle logical name, e.g. \`:core:api\`)
when scoping one submodule — from settings.gradle or resolve_dependencies once per session. Omit for single-module projects.
 
## sourceAvailable
 
Every source response includes \`sourceAvailable\`:
- \`true\` — original source; Javadoc, parameter names, and generics are ground truth
- \`false\` — CFR decompilation; structure reliable, Javadoc absent, names may be synthetic
 
## Cache
 
First call per project invokes the build tool (5–10s). Subsequent calls reuse the cache
(<100ms). All extraction tools share the same warm cache. Use \`forceRefresh: true\` on
\`resolve_dependencies\` only when artifacts changed without build file edits (e.g. SNAPSHOT
republish, manual cache wipe) — not on every call.
 
## Errors
 
- \`transient\` (isRetryable: true) — retry once after a delay, then surface the failure
- \`validation\` — fix the input; retrying will always fail
- \`permission\` — environment needs fixing; do not retry
- \`business\` — expected outcomes, not failures:
  - \`found: false, querySucceeded: true\` → class absent from classpath; verify the FQN
  - \`found: true, methodFound: false\` → class exists, method name wrong; use \`get_class_structure\` to browse
  - \`find_in_class_source\` with \`found: false, querySucceeded: true\` → class resolved, substring/regex absent; adjust query
  - \`sourceAvailable: false\` → no sources JAR; decompilation used automatically, not an error
 
On any error: surface it. Never fall back to manual inspection.
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
        'On failure: isError=true with errorCategory, isRetryable, description, and stable code (§7). ' +
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
        'Use forceRefresh to bypass the hash cache after dependency changes without build-file edits. ' +
        'On failure: isError=true with errorCategory, isRetryable, description, and code RESOLUTION_FAILED.',
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
        return mcpToolResultFromResolutionResult(result, args.projectRoot);
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
        'Optional limit (default 50, max 200). Same projectRoot, modulePath, configuration, includeTest, and forceRefresh semantics as get_class_source. ' +
        'v3 indexes external and local-file JAR `.class` paths (ZIP central directory) plus source enrichment from sibling `-sources.jar` when Gradle listed `sourcesJarPath`, and from inter-project `src/main/java` (+ `src/test/java` when includeTest). ' +
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
        'Returns structured metadata for a fully-qualified class: kind, superclass, interfaces, type parameters, fields, and methods. ' +
        'Includes inherited public/protected instance methods from supertypes (javap on the resolved classpath). ' +
        'Optional `include`: array of `hierarchy` (recursive superclass chain + all super-interfaces), `fields` (omit to return an empty fields array when projecting), `annotations` (runtime-visible annotations from javap on the primary type, class, declared fields/methods — javap-rendered summaries). ' +
        'When `include` is omitted, behavior matches the original tool (fields populated; no typeHierarchy or class/member annotations sections). ' +
        'sourceAvailable is true when the primary type was loaded from a sources JAR (Javadoc on declared members); inherited entries are still bytecode-derived. ' +
        'Does not decompile (no CFR). Uses the same classpath selection as get_class_source. ' +
        'Inter-project submodule classes (`origin: interproject`) resolve from Gradle output dirs for javap and from `src/main/java`/`src/test/java` for sourced metadata when available. On javap failure: code SIGNATURE_EXTRACT_FAILED.',
      inputSchema: getClassStructureInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: ClassSourceQueryContext = {
        projectRoot: args.projectRoot,
        modulePath: args.modulePath,
        configuration: args.configuration,
        includeTest: args.includeTest,
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
