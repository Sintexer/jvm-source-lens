import { expect, test } from 'bun:test';
import type { ClassSourceError } from './extractor/class-source-types.js';
import {
  mcpToolResultFromClassSource,
  mcpToolResultFromProjectRootError,
} from './mcp-tool-result.js';

const query = { projectRoot: '/tmp/my-app', modulePath: ':app', configuration: 'compileClasspath' };

test('CLASS_NOT_FOUND is not an MCP error (valid empty result)', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: {
        code: 'CLASS_NOT_FOUND',
        message: 'Class not found in external JARs',
        className: 'com.example.Missing',
        searchedArtifactCount: 12,
      },
    },
    query,
  );
  expect(r.isError).toBe(false);
  const sc = r.structuredContent as { found: boolean; querySucceeded: boolean; description: string };
  expect(sc.found).toBe(false);
  expect(sc.querySucceeded).toBe(true);
  expect(sc.description).toContain('resolved successfully');
  expect(sc.description).toContain('12');
});

test('INVALID_FQN is validation and retryable after fix', () => {
  const r = mcpToolResultFromClassSource(
    { ok: false, error: { code: 'INVALID_FQN', message: 'Empty class name' } },
    query,
  );
  expect(r.isError).toBe(true);
  const sc = r.structuredContent as {
    errorCategory: string;
    isRetryable: boolean;
    description: string;
  };
  expect(sc.errorCategory).toBe('validation');
  expect(sc.isRetryable).toBe(true);
  expect(sc.description).toContain('FQN');
});

test('MODULE_NOT_FOUND is validation', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: 'No module', modulePath: ':nope' },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('validation');
  expect(sc.isRetryable).toBe(true);
});

test('RESOLUTION_FAILED with timeout is transient', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: { code: 'RESOLUTION_FAILED', message: 'Gradle timed out after 120s', stderr: 'ETIMEDOUT' },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean; description: string };
  expect(sc.errorCategory).toBe('transient');
  expect(sc.isRetryable).toBe(true);
  expect(sc.description).toContain('retry');
});

test('RESOLUTION_FAILED with 401 is permission', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: {
        code: 'RESOLUTION_FAILED',
        message: 'Could not resolve',
        stderr: 'Received status code 401 from server: Unauthorized',
      },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('permission');
  expect(sc.isRetryable).toBe(false);
});

test('SOURCES_RESOLVE_FAILED without network hints is business', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: {
        code: 'SOURCES_RESOLVE_FAILED',
        message: 'No sources variant published',
        coordinates: { group: 'g', name: 'a', version: '1' },
      },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('business');
  expect(sc.isRetryable).toBe(false);
});

test('DECOMPILE_FAILED timeout is transient', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: {
        code: 'DECOMPILE_FAILED',
        message: 'CFR timed out after 120000ms',
        className: 'com.example.Foo',
        jarPath: '/lib/foo.jar',
        entryRelPath: 'com/example/Foo.class',
        coordinates: { group: 'g', name: 'a', version: '1' },
      },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('transient');
  expect(sc.isRetryable).toBe(true);
});

test('DECOMPILE_FAILED without timeout is business', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: {
        code: 'DECOMPILE_FAILED',
        message: 'CFR exited with code 1',
        className: 'com.example.Foo',
        jarPath: '/lib/foo.jar',
        entryRelPath: 'com/example/Foo.class',
        coordinates: { group: 'g', name: 'a', version: '1' },
      },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('business');
  expect(sc.isRetryable).toBe(false);
});

test('project root missing is validation', () => {
  const r = mcpToolResultFromProjectRootError('Project path does not exist: /nope', '/nope');
  expect(r.isError).toBe(true);
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean; code: ClassSourceError['code'] };
  expect(sc.errorCategory).toBe('validation');
  expect(sc.isRetryable).toBe(true);
  expect(sc.code).toBe('RESOLUTION_FAILED');
});

test('success includes found=true', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: true,
      source: 'class T {}',
      sourceAvailable: true,
      className: 'com.example.T',
      provenance: {
        kind: 'sourcesJar',
        coordinates: { group: 'g', name: 'a', version: '1' },
        jarPath: '/tmp/a-sources.jar',
      },
    },
    query,
  );
  expect(r.isError).toBe(false);
  const sc = r.structuredContent as { found: boolean; source: string };
  expect(sc.found).toBe(true);
  expect(sc.source).toContain('class T');
});
