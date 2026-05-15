import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildJvmsrcMcpConfigPayload } from './cli-config-command.js';

test('buildJvmsrcMcpConfigPayload has mcpServers.jvmsrc and hints', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfg-'));
  const p = buildJvmsrcMcpConfigPayload(tmp);
  expect(p.mcpServers.jvmsrc.command).toBeTruthy();
  expect(Array.isArray(p.mcpServers.jvmsrc.args)).toBe(true);
  expect(p.mcpServers.jvmsrc.args[p.mcpServers.jvmsrc.args.length - 1]).toBe('mcp');
  expect(p.mcpServers.jvmsrc.env).toEqual({});
  expect(p.hints.projectRoot).toBe(tmp);
  expect(typeof p.hints.hasGradleWrapper).toBe('boolean');
  expect(typeof p.hints.packageVersion).toBe('string');
  expect(typeof p.hints.javaDetected).toBe('boolean');
});

test('hints.hasGradleWrapper true when gradlew exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfg2-'));
  fs.writeFileSync(path.join(tmp, 'gradlew'), '#!/bin/sh\n', { mode: 0o755 });
  const p = buildJvmsrcMcpConfigPayload(tmp);
  expect(p.hints.hasGradleWrapper).toBe(true);
});
