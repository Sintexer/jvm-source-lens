import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compactAdvertisedSchema, installCompactToolList } from './mcp-advertised-schema.js';

function serverWithDummyTool(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  server.registerTool(
    'dummy',
    {
      description: 'dummy',
      inputSchema: {
        className: z.string(),
        projectRoot: z.string().optional(),
        configuration: z.string().optional(),
        forceRefresh: z.boolean().optional(),
      },
    },
    async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
  );
  return server;
}

describe('installCompactToolList', () => {
  test('shouldKeepSdkRequestHandlersFieldWhenSdkIsUpgraded', () => {
    const handlers = (serverWithDummyTool().server as unknown as { _requestHandlers?: unknown })._requestHandlers;
    // If this fails, the MCP SDK renamed or hid `_requestHandlers`: update installCompactToolList.
    expect(handlers instanceof Map).toBe(true);
    expect((handlers as Map<string, unknown>).has('tools/list')).toBe(true);
  });

  test('shouldHideUnadvertisedParamsWhenClientListsTools', async () => {
    const server = serverWithDummyTool();
    installCompactToolList(server);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === 'dummy')!.inputSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(['className']);
    expect(schema.required).toEqual(['className']);
    expect('$schema' in schema).toBe(false);
    await client.close();
  });

  test('shouldThrowWhenToolsAreNotRegisteredYet', () => {
    expect(() => installCompactToolList(new McpServer({ name: 'empty', version: '0.0.0' }))).toThrow(/MCP SDK changed/);
  });
});

describe('compactAdvertisedSchema', () => {
  test('shouldKeepProjectRootOnlyHiddenForResolveDependenciesWhenOtherParamsRemain', () => {
    const schema = {
      type: 'object',
      properties: { projectRoot: {}, forceRefresh: {}, configuration: {} },
      required: ['projectRoot'],
    };
    const out = compactAdvertisedSchema('resolve_dependencies', schema);
    expect(Object.keys(out.properties as object)).toEqual(['forceRefresh', 'configuration']);
    expect(out.required).toEqual([]);
  });

  test('shouldStripNoiseKeysWhenSchemaHasThem', () => {
    const out = compactAdvertisedSchema('x', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: {},
      properties: { n: { type: 'integer', maximum: Number.MAX_SAFE_INTEGER } },
    });
    expect(out).toEqual({ type: 'object', properties: { n: { type: 'integer' } } });
  });
});
