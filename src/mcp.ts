#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { getClassSource } from './get-class-source.js';
import { getPackageDocs } from './get-package-docs.js';
import { mergeSourceExcerptInputs } from './source-excerpt.js';
import {
  classNameNote,
  withResolutionNotes,
  mcpToolResultFromClassSource,
  mcpToolResultFromFindInClassSource,
  mcpToolResultFromMethodSignature,
  mcpToolResultFromPackageDocs,
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
import { buildJvmsrcInstructions, MCP_TOOL_COPY } from './copy/index.js';
import { withCallLog } from './diagnostics/call-log.js';
import { installCompactToolList } from './mcp-advertised-schema.js';
import { inferIncludeTest } from './extractor/match-module.js';
import { classStructureScopeSchema } from './mcp-schemas/class-structure.js';

/** Agent-facing parameter docs. Keep each to one short sentence: they are sent to the model on every turn. */
const D = {
  projectRoot: 'Project root. Omit to use the workspace.',
  modulePath: "Module name (':app', 'app') or a file/dir inside it. Omit (or \"*\") for all.",
  className: 'FQN, e.g. com.fasterxml.jackson.databind.ObjectMapper; a unique simple name works.',
  configuration: 'Classpath configuration (default compile).',
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
    .describe('Library filter, e.g. "jackson": lists matching artifact versions with module counts.'),
  modules: z
    .string()
    .optional()
    .describe(
      'With query: omit for counts only. Module path/prefix list (e.g. ":services,:app") to name modules in scope, or "all" for every module (can be very large).',
    ),
  projectRoot: z.string().optional().describe(D.projectRoot),
  forceRefresh: z.boolean().optional().describe(D.forceRefresh),
});

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

function withInferredIncludeTest(args: Record<string, unknown>): Record<string, unknown> {
  const modulePath = typeof args.modulePath === 'string' ? args.modulePath : undefined;
  const explicit = typeof args.includeTest === 'boolean' ? args.includeTest : undefined;
  const includeTest = inferIncludeTest(modulePath, explicit);
  return includeTest === explicit ? args : { ...args, includeTest };
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
      instructions: buildJvmsrcInstructions(),
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
  type ToolCallback = (args: Record<string, unknown>, extra: never) => Promise<CallToolResult>;
  server.registerTool = ((name: string, config: never, cb: ToolCallback) =>
    registerTool(
      name,
      config,
      withCallLog(name, (args: Record<string, unknown>, extra) => cb(withInferredIncludeTest(args), extra)) as never,
    )) as typeof server.registerTool;

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
        return withResolutionNotes(mcpToolResultFromClassSource(result, query), [
          classNameNote(args.className, result),
          root.note,
        ]);
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
        return withResolutionNotes(mcpToolResultFromFindInClassSource(result, query), [
          classNameNote(args.className, result),
          root.note,
        ]);
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
        return withResolutionNotes(
          mcpToolResultFromResolutionResult(result, root.path, hidden.full, hidden.include as never, args.query, args.modules),
          [root.note],
        );
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
        return withResolutionNotes(mcpToolResultFromSearchClasses(result, queryCtx), [root.note]);
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
        let resolvedClassName: string | undefined;
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
          resolvedClassName ??= classNameNote(args.className, result);
          results.push(mcpToolResultFromMethodSignature(result, query));
        }
        return withResolutionNotes(combineToolResults(results), [resolvedClassName, root.note]);
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
        return withResolutionNotes(mcpToolResultFromClassStructure(result, query), [
          classNameNote(args.className, result),
          root.note,
        ]);
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
        return withResolutionNotes(mcpToolResultFromSearchInArtifact(result, query), [root.note]);
      } catch (e) {
        if (e instanceof UnsupportedProjectError) {
          return mcpToolResultFromProjectRootError(e.message, root.path);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  server.registerTool(
    'get_package_docs',
    {
      ...MCP_TOOL_COPY.get_package_docs,
      inputSchema: z.object({
        packageName: z.string().min(1).describe('Exact package name.'),
        projectRoot: z.string().optional().describe(D.projectRoot),
        modulePath: z.string().optional().describe(D.modulePath),
        configuration: z.string().optional().describe(D.configuration),
        includeTest: z.boolean().optional().describe(D.includeTest),
        forceRefresh: z.boolean().optional().describe(D.forceRefresh),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const root = await locateProjectRoot(args.projectRoot);
      if (!root.ok) {
        return mcpToolResultFromProjectRootError(root.message, args.projectRoot ?? process.cwd());
      }
      try {
        const result = await getPackageDocs({ ...args, projectRoot: root.path });
        return withResolutionNotes(mcpToolResultFromPackageDocs(result), [root.note]);
      } catch (e) {
        if (e instanceof UnsupportedProjectError) {
          return mcpToolResultFromProjectRootError(e.message, root.path);
        }
        return mcpToolResultFromUnexpectedError(e);
      }
    },
  );

  installCompactToolList(server);
  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** True when this file is the process entry (`bun run dev:mcp`, `node dist/mcp.js`). */
function isDirectExecution(): boolean {
  const main = (import.meta as ImportMeta & { main?: boolean }).main;
  if (typeof main === 'boolean') {
    return main;
  }
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  await startMcpServer();
}
