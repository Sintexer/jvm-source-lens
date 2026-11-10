import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

test('README tool table lists every MCP tool and no stale wording', () => {
  const readme = readFileSync(path.join(import.meta.dir, '../../README.md'), 'utf8');
  for (const name of Object.keys(MCP_TOOL_COPY)) {
    expect(readme).toContain(`| **\`${name}\`**`);
  }
  expect(readme).not.toContain('regex or substring searches');
  expect(readme).not.toMatch(/projectRoot[^.\n]{0,20}\brequired\b/);
});

test('descriptions stay short (selection signal, not a manual)', () => {
  for (const [name, t] of Object.entries(MCP_TOOL_COPY)) {
    expect(`${name}:${t.description.length < 480}`).toBe(`${name}:true`);
  }
});
