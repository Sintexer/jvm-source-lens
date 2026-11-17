import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { parseJavaTypeMetadata } from '../class-structure/parse-java-type-metadata.js';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { tryReadJavaSourceFromClasspath, tryReadSourceFromClasspath } from './read-java-source-from-classpath.js';
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

function baseOutput(rootDir: string, artifacts: ResolvedArtifact[]): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: rootDir,
    modules: [
      {
        name: 'root',
        path: rootDir,
        configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }],
      },
    ],
    errors: [],
  };
}

const OUTER = `package com.google.common.collect;
public class ImmutableList {
  public static final class Builder {
    public ImmutableList build(int expectedSize) { return null; }
  }
}
`;

describe('tryReadJavaSourceFromClasspath nested type', () => {
  test('returns the enclosing compilation unit and parses the nested type', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-src-'));
    const sourcesJar = path.join(dir, 'guava-sources.jar');
    fs.writeFileSync(sourcesJar, zipSync({ 'com/google/common/collect/ImmutableList.java': strToU8(OUTER) }));
    const out = baseOutput(dir, [
      artifact({ group: 'com.google.guava', name: 'guava', sourcesJarPath: sourcesJar }),
    ]);

    const r = await tryReadJavaSourceFromClasspath(out, {
      className: 'com.google.common.collect.ImmutableList$Builder',
    });

    expect(r.ok).toBe(true);
    if (!r.ok || !r.hit) {
      return;
    }
    expect(r.sourceText).toBe(OUTER);
    expect(r.provenance.kind).toBe('sourcesJar');
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.nestedIn).toBe('com.google.common.collect.ImmutableList');
      expect(r.provenance.sourceRelativePath).toBe('com/google/common/collect/ImmutableList.java');
    }
    const meta = parseJavaTypeMetadata(r.sourceText, 'com.google.common.collect.ImmutableList$Builder');
    expect(meta!.methods.find((m) => m.jvmMethodName === 'build')?.parameters.map((p) => p.name)).toEqual([
      'expectedSize',
    ]);
  });
});

describe('tryReadJavaSourceFromClasspath SourceFile attribute', () => {
  function libWith(dir: string, classRel: string, internalName: string, sourceFile: string, sources: Record<string, string>) {
    const binJar = path.join(dir, 'lib.jar');
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    fs.writeFileSync(binJar, zipSync({ [classRel]: buildClassFile({ internalName, sourceFile }) }));
    fs.writeFileSync(
      sourcesJar,
      zipSync(Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, strToU8(v)]))),
    );
    return baseOutput(dir, [artifact({ group: 'com.x', name: 'lib', jarPath: binJar, sourcesJarPath: sourcesJar })]);
  }

  test('shouldFindJavaFileInOddFolderWhenPackageLineMatches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-src-'));
    const java = 'package com.x;\npublic class Foo {\n  void run(int times) {}\n}\n';
    const out = libWith(dir, 'com/x/Foo.class', 'com/x/Foo', 'Foo.java', { 'src/gen/Foo.java': java });
    const r = await tryReadJavaSourceFromClasspath(out, { className: 'com.x.Foo' });
    expect(r.ok && r.hit).toBe(true);
  });

  test('shouldNotHitWhenSourceFileIsKotlin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-src-'));
    const out = libWith(dir, 'com/x/FooKt.class', 'com/x/FooKt', 'Foo.kt', {
      'com/x/Foo.kt': 'package com.x\nfun hello() = 1\n',
    });
    const r = await tryReadJavaSourceFromClasspath(out, { className: 'com.x.FooKt' });
    expect(r).toEqual({ ok: true, hit: false });
  });

  test('shouldReturnPrimaryFileWhenSecondaryTopLevelClassIsRequested', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-src-'));
    const java = 'package com.x;\npublic class Primary {}\n\nclass Helper {\n  void help(int times) {}\n}\n';
    const out = libWith(dir, 'com/x/Helper.class', 'com/x/Helper', 'Primary.java', { 'com/x/Primary.java': java });
    const r = await tryReadJavaSourceFromClasspath(out, { className: 'com.x.Helper' });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.hit) {
      throw new Error('expected a source hit');
    }
    expect(r.sourceText).toBe(java);
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.sourceRelativePath).toBe('com/x/Primary.java');
      expect(r.provenance.nestedIn).toBeUndefined();
    }
    const meta = parseJavaTypeMetadata(r.sourceText, 'com.x.Helper');
    expect(meta!.methods.find((m) => m.jvmMethodName === 'help')?.parameters.map((p) => p.name)).toEqual(['times']);
  });

  test('shouldNotHitWhenLocalModuleSourceIsKotlin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-src-'));
    const ktPath = path.join(dir, 'src/main/kotlin/com/x/Foo.kt');
    fs.mkdirSync(path.dirname(ktPath), { recursive: true });
    fs.writeFileSync(ktPath, 'package com.x\nfun hello() = 1\n');
    const r = await tryReadJavaSourceFromClasspath(baseOutput(dir, []), { className: 'com.x.Foo' });
    expect(r.ok ? r.hit : false).toBe(false);
  });
});

describe('tryReadSourceFromClasspath with Kotlin', () => {
  function libWith(dir: string, classRel: string, internalName: string, sourceFile: string, sources: Record<string, string>) {
    const binJar = path.join(dir, 'lib.jar');
    const sourcesJar = path.join(dir, 'lib-sources.jar');
    fs.writeFileSync(binJar, zipSync({ [classRel]: buildClassFile({ internalName, sourceFile }) }));
    fs.writeFileSync(
      sourcesJar,
      zipSync(Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, strToU8(v)]))),
    );
    return baseOutput(dir, [artifact({ group: 'com.x', name: 'lib', jarPath: binJar, sourcesJarPath: sourcesJar })]);
  }

  test('shouldReturnKotlinSourceFromAMultiplatformSourceSetFolder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-kt-'));
    const kt = 'package com.x\n\n/** Doc. */\ninterface Job {\n  fun cancel()\n}\n';
    const out = libWith(dir, 'com/x/Job.class', 'com/x/Job', 'Job.kt', { 'commonMain/Job.kt': kt });
    const r = await tryReadSourceFromClasspath(out, { className: 'com.x.Job' }, ['java', 'kotlin']);
    expect(r.ok && r.hit).toBe(true);
    if (!r.ok || !r.hit) {
      return;
    }
    expect(r.sourceLanguage).toBe('kotlin');
    expect(r.sourceText).toBe(kt);
    if (r.provenance.kind === 'sourcesJar') {
      expect(r.provenance.sourceRelativePath).toBe('commonMain/Job.kt');
    }
  });

  test('shouldKeepJavaOnlyCallersAwayFromKotlin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-kt-'));
    const out = libWith(dir, 'com/x/Job.class', 'com/x/Job', 'Job.kt', { 'commonMain/Job.kt': 'package com.x\ninterface Job\n' });
    expect(await tryReadJavaSourceFromClasspath(out, { className: 'com.x.Job' })).toEqual({ ok: true, hit: false });
  });

  test('shouldReadAKotlinFileFromTheQueriedModuleSourceRoot', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-read-kt-'));
    const ktPath = path.join(dir, 'src/main/kotlin/com/x/Outer.kt');
    fs.mkdirSync(path.dirname(ktPath), { recursive: true });
    fs.writeFileSync(ktPath, 'package com.x\n\nclass Outer {\n  class Inner {\n    fun go() {}\n  }\n}\n');
    const out = baseOutput(dir, []);
    const r = await tryReadSourceFromClasspath(out, { className: 'com.x.Outer$Inner' }, ['java', 'kotlin']);
    expect(r.ok && r.hit).toBe(true);
    if (r.ok && r.hit) {
      expect(r.sourceLanguage).toBe('kotlin');
      if (r.provenance.kind === 'interproject') {
        expect(r.provenance.nestedIn).toBe('com.x.Outer');
        expect(r.provenance.sourceRelativePath).toBe('com/x/Outer.kt');
      }
    }
    const missing = await tryReadSourceFromClasspath(out, { className: 'com.x.Outer$Missing' }, ['java', 'kotlin']);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('CLASS_NOT_FOUND');
    }
  });
});
