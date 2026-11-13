import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Accepted and validated, but not sent to the model: eval transcripts show agents never pass them,
 * and each costs eager tokens on every turn. Error messages still name them when a retry needs one.
 */
const UNADVERTISED_PARAMS: Record<string, readonly string[]> = {
  '*': ['projectRoot', 'configuration', 'forceRefresh', 'maxClasses'],
  resolve_dependencies: ['projectRoot'],
};

type JsonSchema = Record<string, unknown>;

function isEmptyObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

/** Drops keys that only add tokens: `$schema`, `additionalProperties: {}`, and the zod `.int()` safe-integer bound. */
function stripNoise(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripNoise);
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema') continue;
    if (k === 'additionalProperties' && isEmptyObject(v)) continue;
    if (k === 'maximum' && v === Number.MAX_SAFE_INTEGER) continue;
    out[k] = stripNoise(v);
  }
  return out;
}

export function compactAdvertisedSchema(toolName: string, schema: JsonSchema): JsonSchema {
  const hidden = UNADVERTISED_PARAMS[toolName] ?? UNADVERTISED_PARAMS['*']!;
  const compact = stripNoise(schema) as JsonSchema;
  const props = compact.properties as Record<string, unknown> | undefined;
  if (props !== undefined) {
    compact.properties = Object.fromEntries(Object.entries(props).filter(([k]) => !hidden.includes(k)));
  }
  if (Array.isArray(compact.required)) {
    compact.required = compact.required.filter((k) => !hidden.includes(k as string));
  }
  return compact;
}

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;

/** Wraps the SDK's `tools/list` handler; call after every tool is registered. */
export function installCompactToolList(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })._requestHandlers;
  const original = handlers?.get('tools/list');
  if (original === undefined) {
    throw new Error('MCP SDK changed: no tools/list handler to wrap (register tools first).');
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const listed = (await original(request, extra)) as ListToolsResult;
    return {
      ...listed,
      tools: listed.tools.map((t) => ({
        ...t,
        inputSchema: compactAdvertisedSchema(t.name, t.inputSchema as JsonSchema) as ListToolsResult['tools'][number]['inputSchema'],
      })),
    };
  });
}
