import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClassSourceError } from './extractor/class-source-types.js';
import {
  mcpToolResultFromClassSource,
  mcpToolResultFromClassStructure,
  mcpToolResultFromProjectRootError,
} from './mcp-tool-result.js';

const query = { projectRoot: '/tmp/my-app', modulePath: ':app', configuration: 'compileClasspath' };

let diagLogDir: string;
let prevLogDir: string | undefined;

beforeEach(() => {
  diagLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mcp-tr-'));
  prevLogDir = process.env.JVMSRC_LOG_DIR;
  process.env.JVMSRC_LOG_DIR = diagLogDir;
});

afterEach(() => {
  if (prevLogDir === undefined) {
    delete process.env.JVMSRC_LOG_DIR;
  } else {
    process.env.JVMSRC_LOG_DIR = prevLogDir;
  }
  fs.rmSync(diagLogDir, { recursive: true, force: true });
});

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
    { ...query, full: true },
  );
  expect(r.isError).toBe(false);
  const sc = r.structuredContent as { found: boolean; querySucceeded: boolean; message: string };
  expect(sc.found).toBe(false);
  expect(sc.querySucceeded).toBe(true);
  expect(sc.message).toContain('Classpath resolved successfully');
  expect(sc.message).toContain('12');
});

test('mcpToolResultFromClassStructure CLASS_NOT_FOUND is not MCP error (compact text)', () => {
  const r = mcpToolResultFromClassStructure(
    {
      ok: false,
      error: {
        code: 'CLASS_NOT_FOUND',
        message: 'missing',
        className: 'com.example.Missing',
        searchedArtifactCount: 5,
      },
    },
    query,
  );
  expect(r.isError).toBe(false);
  expect(r.structuredContent).toBeUndefined();
  expect(r.content[0]?.type).toBe('text');
  expect((r.content[0] as { text: string }).text).toContain('com.example.Missing');
  expect((r.content[0] as { text: string }).text).toContain('5');
  expect((r.content[0] as { text: string }).text).toContain('message:');
});

test('SIGNATURE_EXTRACT_FAILED without methodName classifies like javap failure', () => {
  const r = mcpToolResultFromClassStructure(
    {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: 'javap timed out after 100ms',
        className: 'a.B',
        jarPath: '/x.jar',
      },
    },
    query,
  );
  expect(r.isError).toBe(true);
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('transient');
  expect(sc.isRetryable).toBe(true);
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
    message: string;
  };
  expect(sc.errorCategory).toBe('validation');
  expect(sc.isRetryable).toBe(true);
  expect(sc.message).toContain('FQN');
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
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean; message: string };
  expect(sc.errorCategory).toBe('transient');
  expect(sc.isRetryable).toBe(true);
  expect(sc.message).toContain('retry');
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
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean; message: string };
  expect(sc.errorCategory).toBe('permission');
  expect(sc.isRetryable).toBe(false);
  expect(r.content[0]?.type === 'text' ? r.content[0].text : '').toContain('credentials missing');
  expect(sc.message).toMatch(/jvmsrc process environment|MCP/i);
});

test('SOURCES_RESOLVE_FAILED with credentials not defined is permission', () => {
  const r = mcpToolResultFromClassSource(
    {
      ok: false,
      error: {
        code: 'SOURCES_RESOLVE_FAILED',
        message: 'Gradle exited with code 1',
        coordinates: { group: 'deltix', name: 'deltix-ember-algo-api', version: '1.14.254' },
        stderr:
          'ERROR: Credentials to access nexus.deltixhub.com repo are NOT defined!\n' +
          'See https://gitlab.deltixhub.com/Deltix/Common/MultilingualPackage/wikis/ProGetCredentials',
      },
    },
    query,
  );
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean; message: string };
  expect(sc.errorCategory).toBe('permission');
  expect(sc.isRetryable).toBe(false);
  const summary = r.content[0]?.type === 'text' ? r.content[0].text : '';
  expect(summary).toContain('repository authentication / credentials missing');
  expect(summary).toContain('deltix:deltix-ember-algo-api:1.14.254');
  expect(sc.message).toMatch(/REPO_USER|credential/i);
  expect(sc.message).toMatch(/MCP/i);
  expect(sc.message).not.toMatch(/Sources artifact unavailable/i);
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
  const summary = r.content[0]?.type === 'text' ? r.content[0].text : '';
  expect(summary).toContain('Sources artifact unavailable');
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

test('success compact returns source text without structuredContent', () => {
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
  expect(r.structuredContent).toBeUndefined();
  expect((r.content[0] as { text: string }).text).toContain('class T');
  expect((r.content[0] as { text: string }).text).not.toContain('message:');
});

test('success full=true includes structured JSON', () => {
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
    { ...query, full: true },
  );
  expect(r.isError).toBe(false);
  const sc = r.structuredContent as { found: boolean; source: string; message?: string };
  expect(sc.found).toBe(true);
  expect(sc.source).toContain('class T');
  expect(sc.message).toBeUndefined();
});
