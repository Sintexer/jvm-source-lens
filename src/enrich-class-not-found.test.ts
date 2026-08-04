import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import type { ResolutionOutput, ResolvedArtifact } from './resolvers/resolution-output.js';
import { enrichClassNotFound, enrichIfClassNotFound } from './enrich-class-not-found.js';

const fakeClassBytes = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);

let prevCacheRoot: string | undefined;
let testCacheRoot: string;

beforeEach(() => {
  testCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cache-root-'));
  prevCacheRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = testCacheRoot;
});

afterEach(() => {
  if (prevCacheRoot === undefined) {
    delete process.env.JVMSRC_CACHE_ROOT;
  } else {
    process.env.JVMSRC_CACHE_ROOT = prevCacheRoot;
  }
  fs.rmSync(testCacheRoot, { recursive: true, force: true });
});

function artifact(partial: Partial<ResolvedArtifact> & Pick<ResolvedArtifact, 'group' | 'name'>): ResolvedArtifact {
  return {
    group: partial.group,
    name: partial.name,
    version: partial.version ?? '1.0',
    type: partial.type ?? 'jar',
    jarPath: partial.jarPath ?? null,
    sourcesJarPath: partial.sourcesJarPath ?? null,
    origin: partial.origin ?? 'external',
    direct: partial.direct ?? false,
    interproject: partial.interproject,
  };
}

function singleModuleOutput(rootDir: string, artifacts: ResolvedArtifact[]): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: rootDir,
    modules: [{ name: 'root', path: rootDir, configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }] }],
    errors: [],
  };
}

function multiModuleOutput(rootDir: string, moduleArtifacts: Record<string, ResolvedArtifact[]>): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: rootDir,
    modules: Object.entries(moduleArtifacts).map(([name, artifacts]) => ({
      name,
      path: path.join(rootDir, name.replace(/^:/, '')),
      configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }],
    })),
    errors: [],
  };
}

describe('enrichClassNotFound', () => {
  test('adds suggestedModulePaths when modulePath omitted on a multimodule project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-enrich-'));
    const out = multiModuleOutput(dir, { ':app': [], ':lib': [] });

    const enriched = enrichClassNotFound(
      dir,
      out,
      { code: 'CLASS_NOT_FOUND', message: 'not found', className: 'com.example.Foo', searchedArtifactCount: 0 },
      {},
    );

    expect(enriched.suggestedModulePaths).toEqual([':app', ':lib']);
  });

  test('omits suggestedModulePaths when modulePath is explicit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-enrich-'));
    const out = multiModuleOutput(dir, { ':app': [], ':lib': [] });

    const enriched = enrichClassNotFound(
      dir,
      out,
      { code: 'CLASS_NOT_FOUND', message: 'not found', className: 'com.example.Foo', searchedArtifactCount: 0 },
      { modulePath: ':app' },
    );

    expect(enriched.suggestedModulePaths).toBeUndefined();
  });

  test('omits suggestedModulePaths on a single-module project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-enrich-'));
    const out = singleModuleOutput(dir, []);

    const enriched = enrichClassNotFound(
      dir,
      out,
      { code: 'CLASS_NOT_FOUND', message: 'not found', className: 'com.example.Foo', searchedArtifactCount: 0 },
      {},
    );

    expect(enriched.suggestedModulePaths).toBeUndefined();
  });

  test('adds did-you-mean suggestions from the class-search index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-enrich-'));
    const jarPath = path.join(dir, 'lib.jar');
    fs.writeFileSync(
      jarPath,
      zipSync({
        'com/example/v2/Foo.class': fakeClassBytes,
        'com/other/Unrelated.class': fakeClassBytes,
      }),
    );

    const out = singleModuleOutput(dir, [artifact({ group: 'g', name: 'lib', jarPath })]);

    const enriched = enrichClassNotFound(
      dir,
      out,
      {
        code: 'CLASS_NOT_FOUND',
        message: 'not found',
        className: 'com.example.v1.Foo',
        searchedArtifactCount: 1,
      },
      {},
    );

    expect(enriched.suggestions).toEqual(['com.example.v2.Foo']);
  });

  test('never throws when the class-search index cannot be built', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-enrich-'));
    const out = singleModuleOutput(dir, [
      artifact({ group: 'g', name: 'lib', jarPath: path.join(dir, 'does-not-exist.jar') }),
    ]);

    expect(() =>
      enrichClassNotFound(
        dir,
        out,
        { code: 'CLASS_NOT_FOUND', message: 'not found', className: 'com.example.Foo', searchedArtifactCount: 1 },
        {},
      ),
    ).not.toThrow();
  });
});

describe('enrichIfClassNotFound', () => {
  test('passes through non-CLASS_NOT_FOUND errors unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-enrich-'));
    const out = singleModuleOutput(dir, []);
    const error = { code: 'MODULE_NOT_FOUND' as const, message: 'nope', modulePath: ':app' };

    expect(enrichIfClassNotFound(dir, out, error, {})).toEqual(error);
  });
});
