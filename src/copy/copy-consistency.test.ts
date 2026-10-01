import { expect, test } from 'bun:test';
import { JVMSRC_INSTRUCTIONS } from './instructions.js';
import { MCP_TOOL_COPY } from './tool-descriptions.js';

const allCopy = [JVMSRC_INSTRUCTIONS, ...Object.values(MCP_TOOL_COPY).map((t) => t.description)];

test('agent-facing copy never mentions parameters that are no longer advertised', () => {
  for (const text of allCopy) {
    expect(text).not.toContain('full=true');
    expect(text).not.toContain('full: true');
    expect(text).not.toMatch(/\binclude\b/);
    expect(text).not.toContain('methodName singular');
  }
});

test('descriptions stay short (selection signal, not a manual)', () => {
  for (const [name, t] of Object.entries(MCP_TOOL_COPY)) {
    expect(`${name}:${t.description.length < 480}`).toBe(`${name}:true`);
  }
});
