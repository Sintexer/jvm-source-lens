import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp.js';

type ToolInfo = { name: string; inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] } };

let client: Client;
let tools: ToolInfo[];

beforeAll(async () => {
  const server = createMcpServer();
  client = new Client({ name: 'schema-test', version: '0.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  tools = (await client.listTools()).tools as ToolInfo[];
});

const props = (name: string) => Object.keys(tools.find((t) => t.name === name)!.inputSchema.properties ?? {});

describe('advertised input schemas', () => {
  test('no tool advertises full, include, or the legacy methodName', () => {
    for (const t of tools) {
      const names = props(t.name);
      expect(names).not.toContain('full');
      expect(names).not.toContain('include');
      expect(names).not.toContain('methodName');
    }
  });

  test('projectRoot is optional everywhere', () => {
    for (const t of tools) {
      expect(t.inputSchema.required ?? []).not.toContain('projectRoot');
    }
  });

  test('every advertised parameter has a description', () => {
    for (const t of tools) {
      for (const [name, def] of Object.entries(t.inputSchema.properties ?? {})) {
        expect(`${t.name}.${name}: ${def.description ?? ''}`).not.toBe(`${t.name}.${name}: `);
      }
    }
  });

  test('schemas carry no $schema, empty additionalProperties, or safe-integer maximum', () => {
    const raw = JSON.stringify(tools.map((t) => t.inputSchema));
    expect(raw).not.toContain('$schema');
    expect(raw).not.toContain('additionalProperties');
    expect(raw).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });

  test('seldom-used parameters are not advertised', () => {
    for (const t of tools) {
      const names = props(t.name);
      expect(names).not.toContain('projectRoot');
      expect(names).not.toContain('configuration');
      expect(names).not.toContain('maxClasses');
      if (t.name !== 'resolve_dependencies') {
        expect(names).not.toContain('forceRefresh');
      }
    }
    expect(props('resolve_dependencies')).toContain('forceRefresh');
  });

  test('scope does not offer "full"', () => {
    const scope = tools.find((t) => t.name === 'get_class_structure')!.inputSchema.properties!.scope as {
      enum?: string[];
    };
    expect(scope.enum).toEqual(['overview', 'declared', 'effective']);
  });
});

describe('tolerated inputs', () => {
  const missingRoot = '/nonexistent-jvmsrc-project';
  // The compact text is a one-line summary; guidance lives in structuredContent / message.
  const text = (r: unknown) => JSON.stringify(r);

  test.each([
    ['string methodNames', { methodNames: 'foo' }],
    ['array methodNames', { methodNames: ['foo', 'bar'] }],
    ['legacy methodName', { methodName: 'foo' }],
  ])('get_method_signature accepts %s (fails later, on the project root)', async (_label, extra) => {
    const r = await client.callTool({
      name: 'get_method_signature',
      arguments: { className: 'a.B', projectRoot: missingRoot, ...extra },
    });
    expect(text(r)).toContain('does not exist');
  });

  test('get_method_signature without any method name is a validation error', async () => {
    const r = await client.callTool({
      name: 'get_method_signature',
      arguments: { className: 'a.B', projectRoot: missingRoot },
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(text(r)).toContain('Provide methodNames');
  });

  test('hidden full / include are accepted and ignored by validation', async () => {
    const r = await client.callTool({
      name: 'get_class_structure',
      arguments: { className: 'a.B', projectRoot: missingRoot, full: true, include: ['fields'] },
    });
    expect(text(r)).toContain('does not exist');
  });

  test('unadvertised configuration / forceRefresh / maxClasses are still accepted', async () => {
    const r = await client.callTool({
      name: 'search_in_artifact',
      arguments: {
        query: 'x',
        coordinates: { group: 'g', name: 'n' },
        projectRoot: missingRoot,
        configuration: 'runtimeClasspath',
        forceRefresh: true,
        maxClasses: 5,
      },
    });
    expect(text(r)).toContain('does not exist');
  });

  test('unadvertised parameters are still type-checked', async () => {
    const r = await client.callTool({
      name: 'get_class_source',
      arguments: { className: 'a.B', projectRoot: missingRoot, forceRefresh: 'yes' },
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(text(r)).toContain('forceRefresh');
  });

  test('get_class_source accepts a bare string methodNames', async () => {
    const r = await client.callTool({
      name: 'get_class_source',
      arguments: { className: 'a.B', projectRoot: missingRoot, methodNames: 'foo' },
    });
    expect(text(r)).toContain('does not exist');
  });
});
