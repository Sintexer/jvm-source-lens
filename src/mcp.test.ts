import { expect, test } from 'bun:test';
import { mcpClassSourceToolPayloadSchema } from './mcp.js';

test('mcpClassSourceToolPayloadSchema accepts success with found=true', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: true,
    found: true,
    source: 'public class T {}',
    sourceAvailable: true,
    className: 'com.example.T',
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a-sources.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpClassSourceToolPayloadSchema accepts not-found payload', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: true,
    found: false,
    className: 'com.example.Missing',
    searchedArtifactCount: 3,
    querySucceeded: true,
    code: 'CLASS_NOT_FOUND',
    description: 'Classpath resolved; class absent.',
  });
  expect(parsed.success).toBe(true);
});

test('mcpClassSourceToolPayloadSchema accepts categorized failure', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: false,
    code: 'INVALID_FQN',
    errorCategory: 'validation',
    isRetryable: true,
    description: 'Fix the class name.',
    error: { code: 'INVALID_FQN', message: 'bad' },
  });
  expect(parsed.success).toBe(true);
});
