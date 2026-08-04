import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { inferModulePath, listModuleNames, resolveModuleScopeOrError } from './infer-module-path.js';

const fakeClassBytes = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);

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

function multiModuleOutput(
  rootDir: string,
  moduleArtifacts: Record<string, ResolvedArtifact[]>,
): ResolutionOutput {
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

function jarWithClass(dir: string, fileName: string, classRelPath: string): string {
  const jarPath = path.join(dir, fileName);
  fs.writeFileSync(jarPath, zipSync({ [classRelPath]: fakeClassBytes }));
  return jarPath;
}

describe('inferModulePath', () => {
  test('explicit modulePath is a pass-through with inferred: false and no scanning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    // A module whose jar would throw on read if scanned — proves the explicit path skips probing.
    const out = multiModuleOutput(dir, {
      ':app': [artifact({ group: 'g', name: 'a', jarPath: path.join(dir, 'does-not-exist.jar') })],
    });

    const r = inferModulePath(out, { className: 'com.example.Foo', modulePath: ':app' });
    expect(r).toEqual({ kind: 'use', modulePath: ':app', inferred: false });
  });

  test('infers the unique module owner across multiple modules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const libJar = jarWithClass(dir, 'lib.jar', 'com/example/Foo.class');

    const out = multiModuleOutput(dir, {
      ':app': [artifact({ group: 'g', name: 'other', jarPath: jarWithClass(dir, 'other.jar', 'com/other/Bar.class') })],
      ':lib': [artifact({ group: 'g', name: 'lib', jarPath: libJar })],
    });

    const r = inferModulePath(out, { className: 'com.example.Foo' });
    expect(r).toEqual({ kind: 'use', modulePath: ':lib', inferred: true });
  });

  test('reports ambiguous when multiple modules own the class', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const jarA = jarWithClass(dir, 'a.jar', 'com/example/Foo.class');
    const jarB = jarWithClass(dir, 'b.jar', 'com/example/Foo.class');

    const out = multiModuleOutput(dir, {
      ':app': [artifact({ group: 'g', name: 'a', jarPath: jarA })],
      ':lib': [artifact({ group: 'g', name: 'b', jarPath: jarB })],
    });

    const r = inferModulePath(out, { className: 'com.example.Foo' });
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.modulePaths).toEqual([':app', ':lib']);
    }
  });

  test('reports none with all module names and summed searched count when no owner exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const jarA = jarWithClass(dir, 'a.jar', 'com/other/A.class');
    const jarB = jarWithClass(dir, 'b.jar', 'com/other/B.class');

    const out = multiModuleOutput(dir, {
      ':app': [artifact({ group: 'g', name: 'a', jarPath: jarA })],
      ':lib': [artifact({ group: 'g', name: 'b', jarPath: jarB })],
    });

    const r = inferModulePath(out, { className: 'com.example.Missing' });
    expect(r.kind).toBe('none');
    if (r.kind === 'none') {
      expect(r.moduleNames).toEqual([':app', ':lib']);
      expect(r.searchedArtifactCount).toBe(2);
    }
  });

  test('listModuleNames returns module names in order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const out = multiModuleOutput(dir, { root: [], ':app': [], ':lib': [] });
    expect(listModuleNames(out)).toEqual(['root', ':app', ':lib']);
  });
});

describe('resolveModuleScopeOrError', () => {
  test('use: returns ok with modulePath', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const libJar = jarWithClass(dir, 'lib.jar', 'com/example/Foo.class');
    const out = multiModuleOutput(dir, { ':lib': [artifact({ group: 'g', name: 'lib', jarPath: libJar })] });

    const r = resolveModuleScopeOrError(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.modulePath).toBe(':lib');
      expect(r.inferred).toBe(true);
    }
  });

  test('ambiguous: returns MODULE_AMBIGUOUS with modulePaths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const jarA = jarWithClass(dir, 'a.jar', 'com/example/Foo.class');
    const jarB = jarWithClass(dir, 'b.jar', 'com/example/Foo.class');
    const out = multiModuleOutput(dir, {
      ':app': [artifact({ group: 'g', name: 'a', jarPath: jarA })],
      ':lib': [artifact({ group: 'g', name: 'b', jarPath: jarB })],
    });

    const r = resolveModuleScopeOrError(out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_AMBIGUOUS');
      if (r.error.code === 'MODULE_AMBIGUOUS') {
        expect(r.error.modulePaths).toEqual([':app', ':lib']);
        expect(r.error.className).toBe('com.example.Foo');
      }
    }
  });

  test('none: returns bare CLASS_NOT_FOUND (unenriched)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-infer-'));
    const jarA = jarWithClass(dir, 'a.jar', 'com/other/A.class');
    const out = multiModuleOutput(dir, { ':app': [artifact({ group: 'g', name: 'a', jarPath: jarA })] });

    const r = resolveModuleScopeOrError(out, { className: 'com.example.Missing' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CLASS_NOT_FOUND');
      if (r.error.code === 'CLASS_NOT_FOUND') {
        expect(r.error.className).toBe('com.example.Missing');
        expect(r.error.suggestions).toBeUndefined();
        expect(r.error.suggestedModulePaths).toBeUndefined();
      }
    }
  });
});
