import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { extractExternalClassSource } from './extract-external-class-source.js';
import { tryReadSourceFromClasspath } from './read-java-source-from-classpath.js';
import type { ClassSourceLookupOptions } from './class-source-types.js';
import { buildClassFile } from './test-class-file.js';

/**
 * Characterization tests for the two classpath walks: `get` (extractExternalClassSource) and
 * structure (tryReadSourceFromClasspath). They must agree on the file they open.
 */

function artifact(p: Partial<ResolvedArtifact> & Pick<ResolvedArtifact, 'group' | 'name'>): ResolvedArtifact {
  return {
    group: p.group,
    name: p.name,
    version: p.version ?? '1.0',
    type: 'jar',
    jarPath: p.jarPath ?? null,
    sourcesJarPath: p.sourcesJarPath ?? null,
    origin: p.origin ?? 'external',
    direct: false,
    interproject: p.interproject,
  };
}

function output(rootDir: string, artifacts: ResolvedArtifact[]): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: rootDir,
    modules: [
      { name: 'root', path: rootDir, configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }] },
    ],
    errors: [],
  };
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-parity-'));
}

function writeZip(file: string, entries: Record<string, Uint8Array>): string {
  fs.writeFileSync(file, zipSync(entries));
  return file;
}

async function both(out: ResolutionOutput, opts: ClassSourceLookupOptions) {
  const get = await extractExternalClassSource(out, { ...opts, decompileExternalClass: async () => ({ ok: false, error: { code: 'DECOMPILE_FAILED', message: 'stub' } }) as never });
  const structure = await tryReadSourceFromClasspath(out, opts, ['java', 'kotlin']);
  return { get, structure };
}

const GREETER = 'package p;\npublic class Greeter {\n  public String hi() { return "hi"; }\n}\n';

describe('source lookup parity: get and structure walks', () => {
  test('shouldOpenSameFileWhenCachedSourcesJarHasClass', async () => {
    const dir = tmp();
    const sj = writeZip(path.join(dir, 'a-sources.jar'), { 'p/Greeter.java': strToU8(GREETER) });
    const { get, structure } = await both(output(dir, [artifact({ group: 'g', name: 'a', sourcesJarPath: sj })]), {
      className: 'p.Greeter',
    });
    expect(get.ok && get.source).toBe(GREETER);
    expect(structure.ok && structure.hit && structure.sourceText).toBe(GREETER);
    expect(get.ok && get.provenance.kind).toBe('sourcesJar');
    expect(structure.ok && structure.hit && structure.provenance.kind).toBe('sourcesJar');
  });

  test('shouldOpenSameFileWhenSourcesJarIsResolvedOnDemand', async () => {
    const dir = tmp();
    const jar = writeZip(path.join(dir, 'a.jar'), { 'p/Greeter.class': buildClassFile({ internalName: 'p/Greeter' }) });
    const sj = writeZip(path.join(dir, 'a-sources.jar'), { 'p/Greeter.java': strToU8(GREETER) });
    const calls: string[] = [];
    const opts: ClassSourceLookupOptions = {
      className: 'p.Greeter',
      resolveSourcesJar: async (c) => {
        calls.push(c.name);
        return sj;
      },
    };
    const { get, structure } = await both(output(dir, [artifact({ group: 'g', name: 'a', jarPath: jar })]), opts);
    expect(get.ok && get.source).toBe(GREETER);
    expect(structure.ok && structure.hit && structure.sourceText).toBe(GREETER);
    expect(calls).toEqual(['a', 'a']);
  });

  test('shouldOpenSameFileWhenSourceFileAttributeNamesAnotherFile', async () => {
    const dir = tmp();
    const jar = writeZip(path.join(dir, 'a.jar'), {
      'p/Extra.class': buildClassFile({ internalName: 'p/Extra', sourceFile: 'Greeter.java' }),
    });
    const src = 'package p;\npublic class Greeter {}\nclass Extra {}\n';
    const sj = writeZip(path.join(dir, 'a-sources.jar'), { 'p/Greeter.java': strToU8(src) });
    const { get, structure } = await both(
      output(dir, [artifact({ group: 'g', name: 'a', jarPath: jar, sourcesJarPath: sj })]),
      { className: 'p.Extra' },
    );
    expect(get.ok && get.source).toContain('class Extra');
    expect(structure.ok && structure.hit && structure.sourceText).toBe(src);
  });

  test('shouldMissWhenSourceFileJavaDoesNotDeclareTheType', async () => {
    const dir = tmp();
    const jar = writeZip(path.join(dir, 'a.jar'), {
      'p/Ghost.class': buildClassFile({ internalName: 'p/Ghost', sourceFile: 'Greeter.java' }),
    });
    const sj = writeZip(path.join(dir, 'a-sources.jar'), { 'p/Greeter.java': strToU8(GREETER) });
    const { structure } = await both(
      output(dir, [artifact({ group: 'g', name: 'a', jarPath: jar, sourcesJarPath: sj })]),
      { className: 'p.Ghost' },
    );
    expect(structure).toEqual({ ok: true, hit: false });
  });

  test('shouldReturnEnclosingSourceInGetAndCodeInStructureWhenClassIsAnonymous', async () => {
    const dir = tmp();
    const jar = writeZip(path.join(dir, 'a.jar'), { 'p/Greeter$1.class': buildClassFile({ internalName: 'p/Greeter$1' }) });
    const sj = writeZip(path.join(dir, 'a-sources.jar'), { 'p/Greeter.java': strToU8(GREETER) });
    const { get, structure } = await both(
      output(dir, [artifact({ group: 'g', name: 'a', jarPath: jar, sourcesJarPath: sj })]),
      { className: 'p.Greeter$1' },
    );
    expect(get.ok && get.source).toBe(GREETER);
    expect(structure.ok).toBe(false);
    expect(!structure.ok && structure.error.code).toBe('CLASS_NOT_FOUND');
  });

  test('shouldSkipKotlinFileWhenOnlyJavaIsAllowed', async () => {
    const dir = tmp();
    const jar = writeZip(path.join(dir, 'a.jar'), { 'p/Greeter.class': buildClassFile({ internalName: 'p/Greeter', sourceFile: 'Greeter.kt' }) });
    const sj = writeZip(path.join(dir, 'a-sources.jar'), { 'p/Greeter.kt': strToU8('package p\nclass Greeter\n') });
    const out = output(dir, [artifact({ group: 'g', name: 'a', jarPath: jar, sourcesJarPath: sj })]);
    const javaOnly = await tryReadSourceFromClasspath(out, { className: 'p.Greeter' }, ['java']);
    expect(javaOnly).toEqual({ ok: true, hit: false });
  });

  test('shouldReturnErrorValueWhenSourcesJarIsNotAZip', async () => {
    const dir = tmp();
    const bad = path.join(dir, 'bad-sources.jar');
    fs.writeFileSync(bad, 'not a zip');
    const { get, structure } = await both(output(dir, [artifact({ group: 'g', name: 'a', sourcesJarPath: bad })]), {
      className: 'p.Greeter',
    });
    expect(get.ok).toBe(false);
    expect(structure.ok).toBe(false);
  });

  // Fixed in batch 6: a Kotlin file facade renamed with @file:JvmName("Utils")
  // is found by `get` (SourceFile candidate) but rejected by the structure walk (no `Kt` suffix).
  describe('@file:JvmName facade without Kt suffix', () => {
    function fixture() {
      const dir = tmp();
      const jar = writeZip(path.join(dir, 'a.jar'), {
        'p/Utils.class': buildClassFile({ internalName: 'p/Utils', sourceFile: 'Helpers.kt' }),
      });
      const sj = writeZip(path.join(dir, 'a-sources.jar'), {
        'p/Helpers.kt': strToU8('@file:JvmName("Utils")\npackage p\nfun hi() = 1\n'),
      });
      return output(dir, [artifact({ group: 'g', name: 'a', jarPath: jar, sourcesJarPath: sj })]);
    }

    test('shouldFindSourceInGetWalk', async () => {
      const { get } = await both(fixture(), { className: 'p.Utils' });
      expect(get.ok && get.sourceAvailable).toBe(true);
      expect(get.ok && get.sourceLanguage).toBe('kotlin');
    });

    test('shouldFindSourceInStructureWalk', async () => {
      const { structure } = await both(fixture(), { className: 'p.Utils' });
      expect(structure.ok && structure.hit).toBe(true);
    });
  });
});
