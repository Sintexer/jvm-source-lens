#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { getClassSource } from './get-class-source.js';
import {
  mcpToolResultFromClassSource,
  mcpToolResultFromMethodSignature,
  mcpToolResultFromProjectRootError,
  mcpToolResultFromResolutionResult,
  mcpToolResultFromListModules,
  mcpToolResultFromUnexpectedError,
  mcpToolResultFromClassStructure,
  type ClassSourceQueryContext,
  type MethodSignatureQueryContext,
} from './mcp-tool-result.js';
import { resolveProjectRoot } from './project-path.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import { UnsupportedProjectError } from './resolvers/index.js';
import { getClassStructure } from './get-class-structure.js';
import { getMethodSignatures } from './get-method-signatures.js';

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
]);

/** Documented MCP tool payloads (success, not-found, or categorized failure). */
export const mcpClassSourceToolPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.literal(true),
    source: z.string(),
    sourceAvailable: z.boolean(),
    className: z.string(),
    provenance: provenanceSchema,
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

const getClassSourceInputSchema = z.object({
  className: z.string().min(1),
  projectRoot: z.string().min(1),
  modulePath: z.string().optional(),
  configuration: z.string().optional(),
  includeTest: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
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

const resolveDependenciesInputSchema = z.object({
  projectRoot: z.string().min(1),
  forceRefresh: z.boolean().optional(),
});

const listModulesInputSchema = resolveDependenciesInputSchema;

const javapParameterSchema = z.object({
  name: z.string().nullable(),
  typeDisplay: z.string(),
});

const javapOverloadSchema = z.object({
  declarationLine: z.string(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  jvmDescriptor: z.string(),
  genericSignature: z.string().nullable(),
  returnTypeDisplay: z.string().nullable(),
  parameters: z.array(javapParameterSchema),
  thrownExceptions: z.array(z.string()),
  flagsLine: z.string().nullable(),
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
  jvmDescriptor: z.string(),
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

export async function startMcpServer(): Promise<void> {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };

  const server = new McpServer(
    { name: 'jvmsrc', version: pkg.version ?? '0.0.0' },
    {
      instructions:
        'JVM Source Lens (Gradle first): use get_class_source with a fully-qualified class name and projectRoot. ' +
        'Use get_class_structure for structured API metadata (kind, fields, methods including inherited public/protected instance methods) without full source — sourceAvailable is true when the primary type was read from a sources JAR or inter-project `.java`; inherited members may still come from javap when bytecode is available or from parsed source when not. ' +
        'Use get_method_signature when you know className and methodName and need overloads: the implementation prefers parsing `.java` from a sources JAR or inter-project `src/` when present (sourceAvailable=true; synthetic JVM descriptors and no Signature attribute), otherwise falls back to javap bytecode metadata (sourceAvailable=false). ' +
        'Constructors are queried with methodName <init>. Inter-project classes (`origin: interproject`) resolve from sibling `src/main/java` (and `src/test/java` when includeTest) for source-first tools before requiring `build/classes/**` for javap. ' +
        'Use list_modules for submodule names and per-configuration dependency counts without full ResolutionOutput, or resolve_dependencies for the complete document. ' +
        'Both warm or refresh the resolution cache; then get_class_source / get_method_signature / get_class_structure reuse the cache. ' +
        'Failures return errorCategory (transient | validation | business | permission), isRetryable, and a detailed description. ' +
        'CLASS_NOT_FOUND after a successful classpath scan is NOT an error (found=false, querySucceeded=true) — do not retry as if the tool failed. ' +
        'When the class exists but no overloads match: found=true, methodFound=false (not an MCP error). ' +
        'Transient errors: retry after a delay. Validation: fix inputs. Business and permission: do not retry the same request.',
    },
  );

  server.registerTool(
    'get_class_source',
    {
      title: 'Get Java source for a class',
      description:
        'Resolves the project classpath (cached), then returns Java source for a fully-qualified class name. ' +
        'On failure: isError=true with errorCategory, isRetryable, description, and stable code (§7). ' +
        'When the class is absent from a successfully resolved classpath: isError=false, found=false (do not treat as access failure).',
      inputSchema: getClassSourceInputSchema,
      outputSchema: mcpClassSourceToolPayloadSchema,
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
        const result = await getClassSource(args.className, {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
        });
        return mcpToolResultFromClassSource(result, query);
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
      outputSchema: mcpResolveDependenciesPayloadSchema,
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
    'list_modules',
    {
      title: 'List Gradle submodules',
      description:
        'Runs or loads cached Gradle dependency resolution and returns each submodule path plus dependency counts per classpath configuration ' +
        '(artifactCount and directArtifactCount). Omits full ResolutionOutput — use resolve_dependencies for errors[] and artifact lists. ' +
        'Same projectRoot and forceRefresh semantics as resolve_dependencies. On failure: isError=true with code RESOLUTION_FAILED.',
      inputSchema: listModulesInputSchema,
      outputSchema: mcpListModulesPayloadSchema,
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
        });
        return mcpToolResultFromListModules(result, args.projectRoot);
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
        'Resolves the classpath (cached), finds the binary JAR owning the class, runs javap -verbose, and returns all overloads of methodName ' +
        '(parameters with optional names from LocalVariableTable, JVM descriptors, generic Signature attribute when present, checked exceptions). ' +
        'sourceAvailable is always false (bytecode metadata). Use methodName <init> for constructors. ' +
        'On failure: isError=true with errorCategory, isRetryable, description, and stable code (README §7). ' +
        'CLASS_NOT_FOUND after scan: isError=false, found=false. Class found but no overloads: found=true, methodFound=false.',
      inputSchema: getMethodSignatureInputSchema,
      outputSchema: mcpGetMethodSignaturePayloadSchema,
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
        const result = await getMethodSignatures(args.className, args.methodName, {
          projectRoot: root.path,
          modulePath: args.modulePath,
          configuration: args.configuration,
          includeTest: Boolean(args.includeTest),
          forceRefresh: Boolean(args.forceRefresh),
        });
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
      outputSchema: mcpGetClassStructurePayloadSchema,
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
