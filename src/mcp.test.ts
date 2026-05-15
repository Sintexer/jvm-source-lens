import { expect, test } from 'bun:test';
import { mcpClassSourceToolPayloadSchema, mcpResolveDependenciesPayloadSchema } from './mcp.js';
import { mcpToolResultFromResolutionResult } from './mcp-tool-result.js';

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

test('mcpResolveDependenciesPayloadSchema accepts success with resolution', () => {
  const parsed = mcpResolveDependenciesPayloadSchema.safeParse({
    ok: true,
    resolution: {
      schemaVersion: '1.0',
      resolvedAt: '2026-05-15T12:00:00Z',
      buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
      projectRoot: '/tmp/proj',
      modules: [],
      errors: [],
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpResolveDependenciesPayloadSchema accepts RESOLUTION_FAILED failure', () => {
  const parsed = mcpResolveDependenciesPayloadSchema.safeParse({
    ok: false,
    code: 'RESOLUTION_FAILED',
    errorCategory: 'transient',
    isRetryable: true,
    description: 'Gradle failed.',
    error: { code: 'RESOLUTION_FAILED', message: 'Gradle failed.' },
  });
  expect(parsed.success).toBe(true);
});

test('mcpToolResultFromResolutionResult success sets isError false and resolution payload', () => {
  const result = mcpToolResultFromResolutionResult(
    {
      ok: true,
      output: {
        schemaVersion: '1.0',
        resolvedAt: '2026-05-15T12:00:00Z',
        buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
        projectRoot: '/tmp/proj',
        modules: [{ name: ':app', path: '/tmp/proj/app', configurations: [] }],
        errors: [],
      },
    },
    '/tmp/proj',
  );
  expect(result.isError).toBe(false);
  expect(result.structuredContent).toEqual({
    ok: true,
    resolution: expect.objectContaining({ projectRoot: '/tmp/proj', modules: expect.any(Array) }),
  });
});

test('mcpToolResultFromResolutionResult failure sets isError true', () => {
  const result = mcpToolResultFromResolutionResult(
    { ok: false, message: 'Not a Gradle project' },
    '/tmp/bad',
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    code: 'RESOLUTION_FAILED',
    error: { code: 'RESOLUTION_FAILED', message: 'Not a Gradle project' },
  });
});
