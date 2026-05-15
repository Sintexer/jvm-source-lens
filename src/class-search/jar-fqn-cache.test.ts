import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { buildClassSearchIndex } from './build-class-search-index.js';
import { emptyJarFqnCache, readJarFqnCache } from './jar-fqn-cache.js';

const fakeClass = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);

function oneJarOutput(root: string, jarPath: string): ResolutionOutput {
  const art: ResolvedArtifact = {
    group: 'g',
    name: 'n',
    version: '1',
    type: 'jar',
    jarPath,
    sourcesJarPath: null,
    origin: 'external',
    direct: true,
  };
  return {
    schemaVersion: '1.1',
    resolvedAt: 'x',
    buildSystem: { type: 'gradle', version: '8', wrapper: false },
    projectRoot: root,
    modules: [
      {
        name: 'root',
        path: root,
        configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts: [art] }],
      },
    ],
    errors: [],
  };
}

describe('jar-fqn-cache', () => {
  test('readJarFqnCache returns null for missing file', () => {
    expect(readJarFqnCache(os.tmpdir())).toBeNull();
  });

  test('buildClassSearchIndex fills jarFqnCache and second build reuses FQNs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-jfc2-'));
    const jar = path.join(dir, 'lib.jar');
    fs.writeFileSync(
      jar,
      zipSync({
        'com/x/Y.class': fakeClass,
      }),
    );
    const out = oneJarOutput(dir, jar);
    const mod = out.modules[0]!;
    const cfg = mod.configurations[0]!;
    const cache = emptyJarFqnCache();
    const built = buildClassSearchIndex({
      module: mod,
      configuration: cfg,
      includeTest: false,
      buildInputsDigest: 'digest',
      resolutionFingerprint: 'fp1',
      jarFqnCache: cache,
    });
    expect(built.ok).toBe(true);
    expect(Object.keys(cache.jars)).toEqual([jar]);
    const firstStat = cache.jars[jar]!.statKey;
    const firstFqns = [...cache.jars[jar]!.fqns].sort();

    const built2 = buildClassSearchIndex({
      module: mod,
      configuration: cfg,
      includeTest: false,
      buildInputsDigest: 'digest',
      resolutionFingerprint: 'fp2',
      jarFqnCache: cache,
    });
    expect(built2.ok).toBe(true);
    expect(cache.jars[jar]!.statKey).toBe(firstStat);
    expect([...cache.jars[jar]!.fqns].sort()).toEqual(firstFqns);
    if (built.ok && built2.ok) {
      expect(built.file.entries.map((e) => e.className).sort()).toEqual(built2.file.entries.map((e) => e.className).sort());
    }
  });
});
