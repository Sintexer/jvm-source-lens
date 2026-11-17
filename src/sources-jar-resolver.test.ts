import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { resolveGlobalLogRoot } from './diagnostics/log-root.js';
import type { DependencyResolver } from './resolvers/base.js';
import { registerResolverForTesting } from './resolvers/index.js';
import { createSourcesJarResolver } from './sources-jar-resolver.js';

const coords = { group: 'g', name: 'n', version: '1.0' };

test('shouldReturnNullAndRecordDiagnosticWhenSourcesResolutionFails', async () => {
  let calls = 0;
  const resolve = createSourcesJarResolver({
    projectRoot: '/tmp/sources-jar-resolver-test',
    buildSystem: 'gradle',
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
    buildSystem: 'gradle',
    operation: 'get_class_source',
    input: {},
    resolveSourcesJar: async () => ({ ok: true, sourcesJarPath: '/jars/n-sources.jar' }),
  });
  expect(await resolve(coords)).toBe('/jars/n-sources.jar');
});

test('shouldDelegateToRegisteredResolverByBuildSystemIdAndReturnNullWhenUnknown', async () => {
  let seenRoot = '';
  const fake: DependencyResolver = {
    id: 'fake-sjr',
    displayName: 'FakeSjr',
    rootHint: 'fake.build',
    detect: () => false,
    findBuildRoot: () => null,
    cacheInputs: () => ({ files: [], env: [] }),
    isImmutableArtifact: () => false,
    resolve: async () => ({ ok: false, message: 'unused' }),
    resolveSourcesJar: async (projectRoot) => {
      seenRoot = projectRoot;
      return { ok: true, sourcesJarPath: '/fake/n-1.0-sources.jar' };
    },
  };
  const restore = registerResolverForTesting(fake);
  try {
    const resolveFake = createSourcesJarResolver({
      projectRoot: '/tmp/fake-proj',
      buildSystem: 'fake-sjr',
      operation: 'get_class_source',
      input: {},
    });
    expect(await resolveFake(coords)).toBe('/fake/n-1.0-sources.jar');
    expect(seenRoot).toBe('/tmp/fake-proj');

    const resolveUnknown = createSourcesJarResolver({
      projectRoot: '/tmp/unknown-proj',
      buildSystem: 'unknown-build-tool',
      operation: 'get_class_source',
      input: {},
    });
    expect(await resolveUnknown(coords)).toBeNull();
  } finally {
    restore();
  }
});

test('shouldReturnNullAndLogReasonWhenNoSourcesJarIsPublished', async () => {
  const resolve = createSourcesJarResolver({
    projectRoot: '/tmp/sources-jar-resolver-reason',
    buildSystem: 'maven',
    operation: 'get_class_source',
    input: { className: 'a.B' },
    resolveSourcesJar: async () => ({
      ok: true,
      sourcesJarPath: null,
      reason: 'Could not find artifact g:n:jar:sources:9.9.9 in central',
    }),
  });
  expect(await resolve({ group: 'g', name: 'n', version: '9.9.9' })).toBeNull();
  const root = resolveGlobalLogRoot();
  expect(root.ok).toBe(true);
  if (root.ok) {
    const log = fs.readFileSync(path.join(root.path, 'current.log'), 'utf8');
    expect(log).toContain('g:n:jar:sources:9.9.9');
  }
});
