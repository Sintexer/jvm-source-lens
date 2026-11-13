/**
 * Prints the "eager" MCP payload an agent pays for on every turn: server instructions,
 * tool descriptions, and input-schema JSON.
 *
 * With ANTHROPIC_API_KEY set, counts come from the Anthropic `count_tokens` endpoint (method "api"):
 * each number is the delta over a request that carries one empty placeholder tool, so the client's
 * fixed tool-use overhead is not charged to jvmsrc. Without a key it falls back to chars / 4
 * (method "approx"); use approx numbers for before/after deltas only.
 *
 *   bun run measure:tokens           # human-readable table
 *   bun run measure:tokens --json    # machine-readable
 *
 * JVMSRC_TOKEN_MODEL picks the model whose tokenizer is used (default claude-sonnet-4-5).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';

type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
type Method = 'api' | 'approx';

const PLACEHOLDER: ToolDef = { name: 'noop', description: '', input_schema: { type: 'object' } };

const approxTokens = (s: string): number => Math.ceil(s.length / 4);

async function countTokensApi(apiKey: string, tools: ToolDef[], system?: string): Promise<number> {
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.JVMSRC_TOKEN_MODEL ?? 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'x' }],
      tools,
      ...(system ? { system } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`count_tokens failed: HTTP ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { input_tokens: number }).input_tokens;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const client = new Client({ name: 'measure', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const instructions = client.getInstructions() ?? '';
  const { tools } = await client.listTools();
  await client.close();
  const defs: ToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Record<string, unknown>,
  }));

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const method: Method = apiKey ? 'api' : 'approx';
  let instructionsTokens: number;
  let rows: { tool: string; total: number }[];
  let total: number;

  if (apiKey) {
    const base = await countTokensApi(apiKey, [PLACEHOLDER]);
    instructionsTokens = (await countTokensApi(apiKey, [PLACEHOLDER], instructions)) - base;
    rows = [];
    for (const d of defs) {
      rows.push({ tool: d.name, total: (await countTokensApi(apiKey, [PLACEHOLDER, d])) - base });
    }
    total = (await countTokensApi(apiKey, [PLACEHOLDER, ...defs], instructions)) - base;
  } else {
    instructionsTokens = approxTokens(instructions);
    rows = defs.map((d) => ({
      tool: d.name,
      total: approxTokens(`${tools.find((t) => t.name === d.name)?.title ?? ''}${d.description}`) + approxTokens(JSON.stringify(d.input_schema)),
    }));
    total = instructionsTokens + rows.reduce((n, r) => n + r.total, 0);
  }

  const report = { method, instructions: instructionsTokens, tools: rows, total };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`instructions: ${instructionsTokens}`);
    console.table(rows);
    console.log(`TOTAL eager tokens (${method === 'api' ? 'count_tokens API' : 'approx, chars / 4'}): ${total}`);
  }
}

await main();
