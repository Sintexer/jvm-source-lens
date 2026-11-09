import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { resolveGlobalLogRoot } from './diagnostics/log-root.js';
import { createSourcesJarResolver } from './sources-jar-resolver.js';

const coords = { group: 'g', name: 'n', version: '1.0' };

test('shouldReturnNullAndRecordDiagnosticWhenSourcesResolutionFails', async () => {
  let calls = 0;
  const resolve = createSourcesJarResolver({
    projectRoot: '/tmp/sources-jar-resolver-test',
    operation: 'get_class_source',
    input: { className: 'a.B' },
    resolveSourcesJar: async () => {
      calls++;
      return { ok: false, message: 'Gradle exited with code 1: boom' };
    },
  });
  expect(await resolve(coords)).toBeNull();
  expect(await resolve(coords)).toBeNull();
  expect(calls).toBe(1);

  const root = resolveGlobalLogRoot();
  expect(root.ok).toBe(true);
  if (root.ok) {
    const log = fs.readFileSync(path.join(root.path, 'current.log'), 'utf8');
    expect(log).toContain('SOURCES_GRADLE_FAILED');
    expect(log).toContain('boom');
  }
});

test('shouldReturnJarPathWhenSourcesResolutionSucceeds', async () => {
  const resolve = createSourcesJarResolver({
    projectRoot: '/tmp/x',
    operation: 'get_class_source',
    input: {},
    resolveSourcesJar: async () => ({ ok: true, sourcesJarPath: '/jars/n-sources.jar' }),
  });
  expect(await resolve(coords)).toBe('/jars/n-sources.jar');
});
