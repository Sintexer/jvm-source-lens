import { describe, expect, test } from 'bun:test';
import { normalizeObjectSchema, safeParseAsync } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { mcpClassSourceToolPayloadSchema } from './mcp.js';

/**
 * Documents why MCP tools omit outputSchema (see mcp.ts registerTool).
 */
describe('MCP SDK output validation', () => {
  test('z.union payload schemas are not object-normalizable', () => {
    expect(normalizeObjectSchema(mcpClassSourceToolPayloadSchema)).toBeUndefined();
  });

  test('safeParseAsync on undefined schema throws _zod (SDK bug path)', async () => {
    const outputObj = normalizeObjectSchema(mcpClassSourceToolPayloadSchema);
    expect(outputObj).toBeUndefined();
    await expect(
      safeParseAsync(
        outputObj as Parameters<typeof safeParseAsync>[0],
        { ok: true, found: true, source: '', sourceAvailable: true, className: 'x.Y' },
      ),
    ).rejects.toThrow(/_zod/);
  });
});
