#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { getClassSource } from './get-class-source.js';
import {
  mcpToolResultFromClassSource,
  mcpToolResultFromProjectRootError,
  mcpToolResultFromUnexpectedError,
  type ClassSourceQueryContext,
} from './mcp-tool-result.js';
import { resolveProjectRoot } from './project-path.js';

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

export async function startMcpServer(): Promise<void> {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };

  const server = new McpServer(
    { name: 'jvmsrc', version: pkg.version ?? '0.0.0' },
    {
      instructions:
        'JVM Source Lens (Gradle first): use get_class_source with a fully-qualified class name and projectRoot. ' +
        'Failures return errorCategory (transient | validation | business | permission), isRetryable, and a detailed description. ' +
        'CLASS_NOT_FOUND after a successful classpath scan is NOT an error (found=false, querySucceeded=true) — do not retry as if the tool failed. ' +
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
