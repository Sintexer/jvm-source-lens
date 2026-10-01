/**
 * Prints the "eager" MCP payload an agent pays for on every turn: server instructions,
 * tool descriptions, and input-schema JSON. Token counts are approximate (chars / 4);
 * use them for before/after deltas, not absolute billing.
 *
 *   bun run measure:tokens           # human-readable table
 *   bun run measure:tokens --json    # machine-readable
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';

const approxTokens = (s: string): number => Math.ceil(s.length / 4);

async function main(): Promise<void> {
  const server = createMcpServer();
  const client = new Client({ name: 'measure', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const instructions = client.getInstructions() ?? '';
  const { tools } = await client.listTools();

  const rows = tools.map((t) => {
    const description = approxTokens(`${t.title ?? ''}${t.description ?? ''}`);
    const schema = approxTokens(JSON.stringify(t.inputSchema));
    return { tool: t.name, description, schema, total: description + schema };
  });
  const instructionsTokens = approxTokens(instructions);
  const total = instructionsTokens + rows.reduce((n, r) => n + r.total, 0);

  const report = { instructions: instructionsTokens, tools: rows, total };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`instructions: ${instructionsTokens}`);
    console.table(rows);
    console.log(`TOTAL eager tokens (approx): ${total}`);
  }
  await client.close();
}

await main();
