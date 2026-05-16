import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

/**
 * Regression: bundling zod into dist/mcp.js breaks MCP SDK schema conversion (duplicate zod copies).
 * Run after `bun run build`.
 */
describe('dist/mcp.js bundle', () => {
  test('does not inline zod (packages external)', () => {
    const path = new URL('../dist/mcp.js', import.meta.url);
    if (!existsSync(path)) {
      return;
    }
    const code = readFileSync(path, 'utf8');
    expect(code.length).toBeLessThan(400_000);
    expect(code).not.toContain('this["~standard"] =');
  });
});
