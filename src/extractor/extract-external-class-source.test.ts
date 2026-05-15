import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const fakeClassBytes = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { extractExternalClassSource } from './extract-external-class-source.js';

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

function baseOutput(
  rootDir: string,
  artifacts: ResolvedArtifact[],
): ResolutionOutput {
  return {
    schemaVersion: '1.0',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: rootDir,
    modules: [
      {
        name: 'root',
        path: rootDir,
        configurations: [
          {
            name: 'compileClasspath',
            scope: 'compile',
            artifacts,
          },
        ],
      },
    ],
    errors: [],
  };
}

describe('extractExternalClassSource', () => {
  test('returns Java from sources JAR already on artifact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    const body = 'package com.example;\npublic class Foo {}\n';
    fs.writeFileSync(
      sourcesJar,
      zipSync({
        'com/example/Foo.java': strToU8(body),
      }),
    );

    const out = baseOutput(dir, [
      artifact({
        group: 'com.example',
        name: 'lib',
        sourcesJarPath: sourcesJar,
        jarPath: null,
      }),
    ]);

    const r = await extractExternalClassSource(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(body);
      expect(r.sourceAvailable).toBe(true);
      expect(r.provenance.jarPath).toBe(sourcesJar);
    }
  });

  test('on-demand resolveSourcesJar after bytecode match', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const binJar = path.join(dir, 'lib.jar');
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    const body = 'package com.example;\npublic class Foo {}\n';
    fs.writeFileSync(
      binJar,
      zipSync({
        'com/example/Foo.class': fakeClassBytes,
      }),
    );
    fs.writeFileSync(
      sourcesJar,
      zipSync({
        'com/example/Foo.java': strToU8(body),
      }),
    );

    const out = baseOutput(dir, [
      artifact({
        group: 'com.example',
        name: 'lib',
        jarPath: binJar,
        sourcesJarPath: null,
      }),
    ]);

    let resolveCalls = 0;
    const r = await extractExternalClassSource(out, {
      className: 'com.example.Foo',
      resolveSourcesJar: async () => {
        resolveCalls += 1;
        return sourcesJar;
      },
    });
    expect(resolveCalls).toBe(1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(body);
    }
  });

  test('decompiles when only bytecode and no sources', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const binJar = path.join(dir, 'lib.jar');
    fs.writeFileSync(
      binJar,
      zipSync({
        'com/example/Foo.class': fakeClassBytes,
      }),
    );

    const out = baseOutput(dir, [
      artifact({
        group: 'com.example',
        name: 'lib',
        jarPath: binJar,
        sourcesJarPath: null,
      }),
    ]);

    const r = await extractExternalClassSource(out, {
      className: 'com.example.Foo',
      resolveSourcesJar: async () => null,
      decompileExternalClass: async () => ({
        ok: true,
        source: 'decompiled Foo',
        sourceAvailable: false,
        className: 'com.example.Foo',
        provenance: {
          kind: 'decompiled',
          coordinates: { group: 'com.example', name: 'lib', version: '1.0' },
          jarPath: binJar,
          entryRelPath: 'com/example/Foo.class',
          cachePath: '/cache/Foo.java',
        },
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('decompiled Foo');
      expect(r.sourceAvailable).toBe(false);
      expect(r.provenance.kind).toBe('decompiled');
    }
  });

  test('returns DECOMPILE_FAILED when decompile fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const binJar = path.join(dir, 'lib.jar');
    fs.writeFileSync(
      binJar,
      zipSync({
        'com/example/Foo.class': fakeClassBytes,
      }),
    );

    const out = baseOutput(dir, [
      artifact({
        group: 'com.example',
        name: 'lib',
        jarPath: binJar,
        sourcesJarPath: null,
      }),
    ]);

    const r = await extractExternalClassSource(out, {
      className: 'com.example.Foo',
      resolveSourcesJar: async () => null,
      decompileExternalClass: async () => ({
        ok: false,
        error: {
          code: 'DECOMPILE_FAILED',
          message: 'CFR failed',
          className: 'com.example.Foo',
          jarPath: binJar,
          entryRelPath: 'com/example/Foo.class',
          coordinates: { group: 'com.example', name: 'lib', version: '1.0' },
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('DECOMPILE_FAILED');
    }
  });

  test('does not call resolveSourcesJar when class not in jar', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const binJar = path.join(dir, 'lib.jar');
    fs.writeFileSync(binJar, zipSync({ 'com/other/Other.class': fakeClassBytes }));

    const out = baseOutput(dir, [
      artifact({ group: 'com.example', name: 'lib', jarPath: binJar }),
    ]);

    let resolveCalls = 0;
    const r = await extractExternalClassSource(out, {
      className: 'com.example.Foo',
      resolveSourcesJar: async () => {
        resolveCalls += 1;
        return null;
      },
    });
    expect(resolveCalls).toBe(0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CLASS_NOT_FOUND');
    }
  });

  test('CLASS_NOT_FOUND when no external artifacts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const out = baseOutput(dir, []);
    const r = await extractExternalClassSource(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CLASS_NOT_FOUND');
    }
  });
});
