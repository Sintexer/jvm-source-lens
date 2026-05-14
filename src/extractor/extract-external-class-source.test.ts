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
  test('returns Java from sources JAR', () => {
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

    const r = extractExternalClassSource(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(body);
      expect(r.sourceAvailable).toBe(true);
      expect(r.provenance.jarPath).toBe(sourcesJar);
    }
  });

  test('returns DECOMPILE_NOT_IMPLEMENTED when only bytecode exists', () => {
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

    const r = extractExternalClassSource(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('DECOMPILE_NOT_IMPLEMENTED');
      if (r.error.code === 'DECOMPILE_NOT_IMPLEMENTED') {
        expect(r.error.jarPath).toBe(binJar);
        expect(r.error.entryRelPath).toBe('com/example/Foo.class');
      }
    }
  });

  test('CLASS_NOT_FOUND when no external artifacts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const out = baseOutput(dir, []);
    const r = extractExternalClassSource(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CLASS_NOT_FOUND');
      if (r.error.code === 'CLASS_NOT_FOUND') {
        expect(r.error.searchedArtifactCount).toBe(0);
      }
    }
  });

  test('skips interproject artifacts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const out = baseOutput(dir, [
      artifact({
        group: 'x',
        name: 'y',
        type: 'project',
        origin: 'interproject',
        jarPath: null,
        sourcesJarPath: null,
      }),
    ]);
    const r = extractExternalClassSource(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CLASS_NOT_FOUND');
    }
  });
});
