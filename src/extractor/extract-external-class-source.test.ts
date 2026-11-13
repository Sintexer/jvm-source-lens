import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { checkUnscopedFullSourceSize } from '../output-limits.js';

const fakeClassBytes = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);
import type { DecompileExternalClassFn } from '../decompiler/decompile-external-class.js';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { extractExternalClassSource } from './extract-external-class-source.js';
import { buildClassFile } from './test-class-file.js';

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
    schemaVersion: '1.1',
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
      expect(r.sourceLanguage).toBe('java');
      expect(r.provenance.kind).toBe('sourcesJar');
      if (r.provenance.kind === 'sourcesJar') {
        expect(r.provenance.jarPath).toBe(sourcesJar);
        expect(r.provenance.nestedIn).toBeUndefined();
      }
    }
  });

  test('returns inter-project .java before external JAR on classpath', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const depRoot = path.join(dir, 'shared');
    const javaPath = path.join(depRoot, 'src/main/java/com/shared/Util.java');
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    const javaBody = 'package com.shared;\npublic class Util {}\n';
    fs.writeFileSync(javaPath, javaBody);

    const binJar = path.join(dir, 'lib.jar');
    fs.writeFileSync(
      binJar,
      zipSync({
        'com/shared/Util.class': fakeClassBytes,
      }),
    );

    const inter: ResolvedArtifact = {
      group: 'root',
      name: 'shared',
      version: null,
      type: 'project',
      jarPath: null,
      sourcesJarPath: null,
      origin: 'interproject',
      direct: true,
      interproject: { moduleName: ':shared', modulePath: depRoot },
    };

    const out = baseOutput(dir, [
      inter,
      artifact({ group: 'x', name: 'lib', jarPath: binJar, sourcesJarPath: null }),
    ]);

    const r = await extractExternalClassSource(out, { className: 'com.shared.Util' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(javaBody);
      expect(r.sourceAvailable).toBe(true);
      expect(r.provenance.kind).toBe('interproject');
    }
  });

  test('includeTest reads inter-project src/test/java', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const depRoot = path.join(dir, 'shared');
    const javaPath = path.join(depRoot, 'src/test/java/com/shared/TCase.java');
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    const javaBody = 'package com.shared;\npublic class TCase {}\n';
    fs.writeFileSync(javaPath, javaBody);

    const inter: ResolvedArtifact = {
      group: 'root',
      name: 'shared',
      version: null,
      type: 'project',
      jarPath: null,
      sourcesJarPath: null,
      origin: 'interproject',
      direct: true,
      interproject: { moduleName: ':shared', modulePath: depRoot },
    };

    const out = baseOutput(dir, [inter]);
    const r = await extractExternalClassSource(out, {
      className: 'com.shared.TCase',
      includeTest: true,
      configuration: 'compileClasspath',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provenance.kind).toBe('interproject');
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
        sourceLanguage: 'java',
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
      expect(r.sourceLanguage).toBe('java');
      expect(r.provenance.kind).toBe('decompiled');
    }
  });

  test('local-file jar skips Gradle resolveSourcesJar and can decompile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-lf-'));
    const binJar = path.join(dir, 'dep.jar');
    fs.writeFileSync(
      binJar,
      zipSync({
        'com/example/Foo.class': fakeClassBytes,
      }),
    );

    const out = baseOutput(dir, [
      artifact({
        group: '_local',
        name: 'dep.jar',
        version: null,
        type: 'local-file',
        origin: 'local-file',
        jarPath: binJar,
        sourcesJarPath: null,
      }),
    ]);

    let resolveCalls = 0;
    const r = await extractExternalClassSource(out, {
      className: 'com.example.Foo',
      resolveSourcesJar: async () => {
        resolveCalls += 1;
        return '/tmp/fake-sources.jar';
      },
      decompileExternalClass: async () => ({
        ok: true,
        source: 'from local jar',
        sourceAvailable: false,
        sourceLanguage: 'java',
        className: 'com.example.Foo',
        provenance: {
          kind: 'decompiled',
          coordinates: { group: '_local', name: 'dep.jar', version: null },
          jarPath: binJar,
          entryRelPath: 'com/example/Foo.class',
          cachePath: '/c',
        },
      }),
    });
    expect(resolveCalls).toBe(0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('from local jar');
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

  test('slices a nested type from the enclosing sources file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const pad = `/*${'x'.repeat(70_000)}*/\n`;
    const body =
      `${pad}package com.example;\n` +
      'public class Outer {\n' +
      '  /** docs */\n' +
      '  public static class Builder {\n' +
      '    public void build() {}\n' +
      '  }\n' +
      '}\n';
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    const binJar = path.join(dir, 'lib.jar');
    fs.writeFileSync(sourcesJar, zipSync({ 'com/example/Outer.java': strToU8(body) }));
    fs.writeFileSync(binJar, zipSync({ 'com/example/Outer$Builder.class': fakeClassBytes }));

    const out = baseOutput(dir, [
      artifact({ group: 'com.example', name: 'lib', jarPath: binJar, sourcesJarPath: sourcesJar }),
    ]);
    const r = await extractExternalClassSource(out, { className: 'com.example.Outer$Builder' });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.sourceAvailable).toBe(true);
    expect(r.source.startsWith('// jvmsrc: com/example/Outer.java:')).toBe(true);
    expect(r.source).toContain('/** docs */');
    expect(r.source).toContain('class Builder');
    expect(r.source).toContain('void build()');
    expect(r.source).not.toContain(pad);
    expect(r.compilationUnit).toBe(body);
    expect(checkUnscopedFullSourceSize(r.className, r.source).ok).toBe(true);
    expect(checkUnscopedFullSourceSize(r.className, r.compilationUnit ?? '').ok).toBe(false);
    expect(r.provenance.kind).toBe('sourcesJar');
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.nestedIn).toBe('com.example.Outer');
      expect(r.provenance.sourceRelativePath).toBe('com/example/Outer.java');
    }
  });

  test('an exact nested source file is returned whole', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const body = 'package com.example;\npublic class Builder {}\n';
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    fs.writeFileSync(sourcesJar, zipSync({ 'com/example/Outer$Builder.java': strToU8(body) }));
    const out = baseOutput(dir, [
      artifact({ group: 'com.example', name: 'lib', jarPath: null, sourcesJarPath: sourcesJar }),
    ]);
    const r = await extractExternalClassSource(out, { className: 'com.example.Outer$Builder' });
    expect(r.ok).toBe(true);
    if (r.ok && r.provenance.kind === 'sourcesJar') {
      expect(r.source).toBe(body);
      expect(r.compilationUnit).toBeUndefined();
      expect(r.provenance.nestedIn).toBe('com.example.Outer');
      expect(r.provenance.sourceRelativePath).toBe('com/example/Outer$Builder.java');
    }
  });

  test('a digit nested name does not return the enclosing file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const body = 'package com.example;\npublic class Outer { void m() {} }\n';
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    const binJar = path.join(dir, 'lib.jar');
    fs.writeFileSync(sourcesJar, zipSync({ 'com/example/Outer.java': strToU8(body) }));
    fs.writeFileSync(binJar, zipSync({ 'com/example/Outer$1.class': fakeClassBytes }));
    const out = baseOutput(dir, [
      artifact({ group: 'com.example', name: 'lib', jarPath: binJar, sourcesJarPath: sourcesJar }),
    ]);
    let decompiled = '';
    const r = await extractExternalClassSource(out, {
      className: 'com.example.Outer$1',
      decompileExternalClass: async (opts) => {
        decompiled = opts.entryRelPath;
        return {
          ok: false,
          error: {
            code: 'DECOMPILE_FAILED',
            message: 'nope',
            className: opts.className,
            jarPath: opts.jarPath,
            entryRelPath: opts.entryRelPath,
            coordinates: opts.coordinates,
          },
        };
      },
    });
    expect(decompiled).toBe('');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CLASS_NOT_FOUND');
      expect(r.error.message).toBe(
        'com.example.Outer$1 is an anonymous or local class. The enclosing class is com.example.Outer.',
      );
    }
  });

  test('slices a nested type from an inter-project tree', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extract-'));
    const depRoot = path.join(dir, 'shared');
    const javaPath = path.join(depRoot, 'src/main/java/com/shared/Outer.java');
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    fs.writeFileSync(
      javaPath,
      'package com.shared;\npublic class Outer {\n  public static class Inner { int n; }\n}\n',
    );
    const inter: ResolvedArtifact = {
      group: 'root',
      name: 'shared',
      version: null,
      type: 'project',
      jarPath: null,
      sourcesJarPath: null,
      origin: 'interproject',
      direct: true,
      interproject: { moduleName: ':shared', modulePath: depRoot },
    };
    const r = await extractExternalClassSource(baseOutput(dir, [inter]), { className: 'com.shared.Outer$Inner' });
    expect(r.ok).toBe(true);
    if (r.ok && r.provenance.kind === 'interproject') {
      expect(r.source).toContain('class Inner');
      expect(r.source).toContain('int n;');
      expect(r.source.startsWith('// jvmsrc: com/shared/Outer.java:')).toBe(true);
      expect(r.provenance.nestedIn).toBe('com.shared.Outer');
      expect(r.provenance.sourceRelativePath).toBe('com/shared/Outer.java');
    }
  });
});

describe('extractExternalClassSource SourceFile attribute', () => {
  function libWith(dir: string, classes: Record<string, Uint8Array>, sources: Record<string, string>) {
    const binJar = path.join(dir, 'lib.jar');
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    fs.writeFileSync(binJar, zipSync(classes));
    fs.writeFileSync(
      sourcesJar,
      zipSync(Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, strToU8(v)]))),
    );
    return baseOutput(dir, [artifact({ group: 'com.x', name: 'lib', jarPath: binJar, sourcesJarPath: sourcesJar })]);
  }

  const failDecompile: DecompileExternalClassFn = async (opts) => ({
    ok: false,
    error: {
      code: 'DECOMPILE_FAILED',
      message: 'should not decompile',
      className: opts.className,
      jarPath: opts.jarPath,
      entryRelPath: opts.entryRelPath,
      coordinates: opts.coordinates,
    },
  });

  test('shouldReturnKotlinFileWhenFacadeClassNamesItInSourceFile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-sf-'));
    const kt = 'package com.x\n\nfun hello(name: String) = "hi $name"\n';
    const out = libWith(
      dir,
      { 'com/x/FooKt.class': buildClassFile({ internalName: 'com/x/FooKt', sourceFile: 'Foo.kt' }) },
      { 'com/x/Foo.kt': kt },
    );
    const r = await extractExternalClassSource(out, { className: 'com.x.FooKt', decompileExternalClass: failDecompile });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.source).toBe(kt);
    expect(r.sourceAvailable).toBe(true);
    expect(r.sourceLanguage).toBe('kotlin');
    expect(r.compilationUnit).toBeUndefined();
    expect(r.provenance.kind).toBe('sourcesJar');
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.sourceRelativePath).toBe('com/x/Foo.kt');
      expect(r.provenance.nestedIn).toBeUndefined();
    }
  });

  test('shouldSliceSecondaryTopLevelClassWhenSourceFileIsAnotherJavaFile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-sf-'));
    const java = 'package com.x;\npublic class Primary {}\n\nclass Helper {\n  void help() {}\n}\n';
    const out = libWith(
      dir,
      { 'com/x/Helper.class': buildClassFile({ internalName: 'com/x/Helper', sourceFile: 'Primary.java' }) },
      { 'com/x/Primary.java': java },
    );
    const r = await extractExternalClassSource(out, { className: 'com.x.Helper', decompileExternalClass: failDecompile });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.source.startsWith('// jvmsrc: com/x/Primary.java:4-6\n')).toBe(true);
    expect(r.source).toContain('void help()');
    expect(r.source).not.toContain('class Primary');
    expect(r.compilationUnit).toBe(java);
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.sourceRelativePath).toBe('com/x/Primary.java');
      expect(r.provenance.nestedIn).toBeUndefined();
    }
  });

  test('shouldReturnWholeKotlinFileWhenNestedClassComesFromKotlin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-sf-'));
    const kt = 'package com.x\n\nclass Outer {\n  class Inner\n}\n';
    const out = libWith(
      dir,
      { 'com/x/Outer$Inner.class': buildClassFile({ internalName: 'com/x/Outer$Inner', sourceFile: 'Outer.kt' }) },
      { 'com/x/Outer.kt': kt },
    );
    const r = await extractExternalClassSource(out, {
      className: 'com.x.Outer$Inner',
      decompileExternalClass: failDecompile,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.source).toBe(kt);
    expect(r.compilationUnit).toBeUndefined();
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.nestedIn).toBe('com.x.Outer');
      expect(r.provenance.sourceRelativePath).toBe('com/x/Outer.kt');
    }
  });

  test('shouldUseNameCandidatesWhenClassHasNoSourceFile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-sf-'));
    const binJar = path.join(dir, 'lib.jar');
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    const java = 'package com.x;\npublic class Foo {}\n';
    fs.writeFileSync(binJar, zipSync({ 'com/x/Foo.class': buildClassFile({ internalName: 'com/x/Foo' }) }));
    fs.writeFileSync(sourcesJar, zipSync({ 'com/x/Foo.java': strToU8(java) }));
    const out = baseOutput(dir, [artifact({ group: 'com.x', name: 'lib', jarPath: binJar })]);
    const r = await extractExternalClassSource(out, {
      className: 'com.x.Foo',
      resolveSourcesJar: async () => sourcesJar,
      decompileExternalClass: failDecompile,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(java);
      if (r.provenance.kind === 'sourcesJar') {
        expect(r.provenance.sourceRelativePath).toBeUndefined();
      }
    }
  });
});

describe('extractExternalClassSource inter-project languages', () => {
  function sibling(dir: string, depRoot: string) {
    return baseOutput(dir, [
      {
        group: 'root',
        name: 'shared',
        version: null,
        type: 'project',
        jarPath: null,
        sourcesJarPath: null,
        origin: 'interproject',
        direct: true,
        interproject: { moduleName: ':shared', modulePath: depRoot },
      },
    ]);
  }

  test('shouldReturnKotlinSourceWhenSiblingModuleHasKtFile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-kt-'));
    const depRoot = path.join(dir, 'shared');
    const ktPath = path.join(depRoot, 'src/main/kotlin/com/shared/Greeter.kt');
    fs.mkdirSync(path.dirname(ktPath), { recursive: true });
    const kt = 'package com.shared\n\nclass Greeter {\n  fun hello() = "hi"\n}\n';
    fs.writeFileSync(ktPath, kt);

    const r = await extractExternalClassSource(sibling(dir, depRoot), { className: 'com.shared.Greeter' });
    expect(r.ok).toBe(true);
    if (r.ok && r.provenance.kind === 'interproject') {
      expect(r.source).toBe(kt);
      expect(r.sourceLanguage).toBe('kotlin');
      expect(r.provenance.sourceRelativePath).toBe('com/shared/Greeter.kt');
    }
  });

  test('shouldReturnKotlinFileWhenCompiledFacadeNamesItInSourceFile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-kt-'));
    const depRoot = path.join(dir, 'shared');
    const classRel = 'com/shared/FooKt.class';
    const classPath = path.join(depRoot, 'build/classes/kotlin/main', classRel);
    fs.mkdirSync(path.dirname(classPath), { recursive: true });
    fs.writeFileSync(classPath, buildClassFile({ internalName: 'com/shared/FooKt', sourceFile: 'Foo.kt' }));
    const ktPath = path.join(depRoot, 'src/main/kotlin/com/shared/Foo.kt');
    fs.mkdirSync(path.dirname(ktPath), { recursive: true });
    const kt = 'package com.shared\n\nfun hello() = 1\n';
    fs.writeFileSync(ktPath, kt);

    const r = await extractExternalClassSource(sibling(dir, depRoot), { className: 'com.shared.FooKt' });
    expect(r.ok).toBe(true);
    if (r.ok && r.provenance.kind === 'interproject') {
      expect(r.source).toBe(kt);
      expect(r.compilationUnit).toBeUndefined();
      expect(r.provenance.nestedIn).toBeUndefined();
      expect(r.provenance.sourceRelativePath).toBe('com/shared/Foo.kt');
    }
  });
});
