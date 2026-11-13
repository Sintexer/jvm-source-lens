import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { parseJavaTypeMetadata } from '../class-structure/parse-java-type-metadata.js';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { tryReadJavaSourceFromClasspath } from './read-java-source-from-classpath.js';

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
