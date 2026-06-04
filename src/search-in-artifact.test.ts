import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import {
  searchInArtifactFromOutput,
  selectArtifact,
  type ArtifactSelector,
} from './search-in-artifact.js';
import type { ResolutionOutput, ResolvedArtifact } from './resolvers/resolution-output.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevCacheRoot: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-sia-'));
  prevCacheRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = tmpDir;
});

afterEach(() => {
  if (prevCacheRoot === undefined) {
    delete process.env.JVMSRC_CACHE_ROOT;
  } else {
    process.env.JVMSRC_CACHE_ROOT = prevCacheRoot;
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

let jarCounter = 0;

/**
 * Build a minimal JAR (ZIP) containing one compiled-class stub and an optional
 * sources-JAR entry.
 *
 * @param entries  map of zip entry name → UTF-8 string content
 */
function makeJar(entries: Record<string, string>): string {
  const jarPath = path.join(tmpDir, `test-${++jarCounter}.jar`);
  const data: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(entries)) {
    data[name] = new TextEncoder().encode(content);
  }
  fs.writeFileSync(jarPath, zipSync(data));
  return jarPath;
}

function makeArtifact(
  overrides: Partial<ResolvedArtifact> & { jarPath: string },
): ResolvedArtifact {
  return {
    group: 'com.example',
    name: 'lib',
    version: '1.0',
    type: 'jar',
    sourcesJarPath: null,
    origin: 'external',
    direct: true,
    ...overrides,
  };
}

function makeOutput(artifact: ResolvedArtifact): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2026-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: tmpDir,
    modules: [
      {
        name: 'root',
        path: tmpDir,
        configurations: [
          { name: 'compileClasspath', scope: 'compile', artifacts: [artifact] },
        ],
      },
    ],
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// selectArtifact (unit)
// ---------------------------------------------------------------------------

describe('selectArtifact', () => {
  const base: ResolvedArtifact = {
    group: 'com.example',
    name: 'lib',
    version: '1.0',
    type: 'jar',
    jarPath: '/tmp/lib-1.0.jar',
    sourcesJarPath: null,
    origin: 'external',
    direct: true,
  };

  test('matches by exact jarPath', () => {
    const result = selectArtifact([base], { jarPath: '/tmp/lib-1.0.jar' });
    expect('matched' in result).toBe(true);
  });

  test('returns ARTIFACT_NOT_FOUND for unknown jarPath', () => {
    const result = selectArtifact([base], { jarPath: '/tmp/missing.jar' });
    expect(result).toMatchObject({ ok: true, found: false, code: 'ARTIFACT_NOT_FOUND' });
  });

  test('matches by coordinates with version', () => {
    const result = selectArtifact([base], {
      coordinates: { group: 'com.example', name: 'lib', version: '1.0' },
    });
    expect('matched' in result).toBe(true);
  });

  test('matches by coordinates without version (loose)', () => {
    const result = selectArtifact([base], {
      coordinates: { group: 'com.example', name: 'lib' },
    });
    expect('matched' in result).toBe(true);
  });

  test('returns ARTIFACT_NOT_FOUND when coordinates miss', () => {
    const result = selectArtifact([base], {
      coordinates: { group: 'org.other', name: 'lib', version: '1.0' },
    });
    expect(result).toMatchObject({ ok: true, found: false, code: 'ARTIFACT_NOT_FOUND' });
  });

  test('returns ARTIFACT_AMBIGUOUS when loose coords match multiple distinct JARs', () => {
    const v2: ResolvedArtifact = { ...base, version: '2.0', jarPath: '/tmp/lib-2.0.jar' };
    const selector: ArtifactSelector = { coordinates: { group: 'com.example', name: 'lib' } };
    const result = selectArtifact([base, v2], selector);
    expect(result).toMatchObject({ ok: true, found: false, code: 'ARTIFACT_AMBIGUOUS' });
    if ('ok' in result && result.ok && !result.found && result.code === 'ARTIFACT_AMBIGUOUS') {
      expect(result.candidates?.length).toBe(2);
    }
  });

  test('does NOT return ARTIFACT_AMBIGUOUS when loose coords match same JAR twice', () => {
    // Same jarPath → deduplicated → single match
    const dup: ResolvedArtifact = { ...base, version: '1.0' };
    const result = selectArtifact([base, dup], {
      coordinates: { group: 'com.example', name: 'lib' },
    });
    expect('matched' in result).toBe(true);
  });

  test('returns ARTIFACT_NOT_FOUND when no selector provided', () => {
    const result = selectArtifact([base], {});
    expect(result).toMatchObject({ ok: true, found: false, code: 'ARTIFACT_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// searchInArtifactFromOutput — integration with real synthetic JAR
// ---------------------------------------------------------------------------

describe('searchInArtifactFromOutput', () => {
  test('finds a literal string inside a sources-JAR entry', async () => {
    const sourcesJar = makeJar({
      'com/example/Hello.java': `
package com.example;
public class Hello {
    public String greet() {
        return "Hello, world!";
    }
}
`,
    });
    const binaryJar = makeJar({
      'com/example/Hello.class': '\xca\xfe\xba\xbe',
    });

    const artifact = makeArtifact({
      group: 'com.example', name: 'lib', version: '1.0',
      jarPath: binaryJar,
      sourcesJarPath: sourcesJar,
    });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { coordinates: { group: 'com.example', name: 'lib', version: '1.0' } },
      query: 'Hello, world!',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.hitCount).toBeGreaterThan(0);
    expect(result.hits[0]!.className).toBe('com.example.Hello');
    expect(result.hits[0]!.sourceAvailable).toBe(true);
    expect(result.hits[0]!.hits[0]!.matchedText).toContain('Hello, world!');
  });

  test('finds hits across multiple classes', async () => {
    const sourcesJar = makeJar({
      'com/example/Alpha.java': 'public class Alpha { static final String TAG = "MARKER"; }',
      'com/example/Beta.java': 'public class Beta { static final String TAG = "MARKER"; }',
    });
    const binaryJar = makeJar({
      'com/example/Alpha.class': '\xca\xfe\xba\xbe',
      'com/example/Beta.class': '\xca\xfe\xba\xbe',
    });

    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: sourcesJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: 'MARKER',
    });

    expect(result.ok && result.found).toBe(true);
    if (!result.ok || !result.found) return;
    expect(result.hits.length).toBe(2);
    expect(result.totalMatches).toBe(2);
  });

  test('returns zero hits (found=true) when query not present', async () => {
    const sourcesJar = makeJar({ 'com/example/Empty.java': 'public class Empty {}' });
    const binaryJar = makeJar({ 'com/example/Empty.class': '\xca\xfe\xba\xbe' });

    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: sourcesJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: 'DOES_NOT_EXIST_XYZ',
    });

    expect(result.ok && result.found).toBe(true);
    if (!result.ok || !result.found) return;
    expect(result.hitCount).toBe(0);
    expect(result.hits.length).toBe(0);
  });

  test('respects maxHits cap and sets truncated=true', async () => {
    // Three classes each containing the query → maxHits=1 should truncate
    const sourcesJar = makeJar({
      'com/example/A.java': 'public class A { String s = "TARGET"; }',
      'com/example/B.java': 'public class B { String s = "TARGET"; }',
      'com/example/C.java': 'public class C { String s = "TARGET"; }',
    });
    const binaryJar = makeJar({
      'com/example/A.class': '\xca\xfe\xba\xbe',
      'com/example/B.class': '\xca\xfe\xba\xbe',
      'com/example/C.class': '\xca\xfe\xba\xbe',
    });

    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: sourcesJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: 'TARGET',
      maxHits: 1,
    });

    expect(result.ok && result.found).toBe(true);
    if (!result.ok || !result.found) return;
    expect(result.hitCount).toBe(1);
    expect(result.truncated).toBe(true);
  });

  test('respects maxClasses cap and sets truncated=true', async () => {
    const sourcesJar = makeJar({
      'com/example/A.java': 'public class A {}',
      'com/example/B.java': 'public class B {}',
      'com/example/C.java': 'public class C {}',
    });
    const binaryJar = makeJar({
      'com/example/A.class': '\xca\xfe\xba\xbe',
      'com/example/B.class': '\xca\xfe\xba\xbe',
      'com/example/C.class': '\xca\xfe\xba\xbe',
    });

    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: sourcesJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: 'class',
      maxClasses: 1,
    });

    expect(result.ok && result.found).toBe(true);
    if (!result.ok || !result.found) return;
    expect(result.classesScanned).toBe(1);
    expect(result.truncated).toBe(true);
  });

  test('regex mode matches pattern correctly', async () => {
    const sourcesJar = makeJar({
      'com/example/Rx.java': 'public class Rx { int value = 42; }',
    });
    const binaryJar = makeJar({
      'com/example/Rx.class': '\xca\xfe\xba\xbe',
    });

    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: sourcesJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: '\\d+',
      regex: true,
    });

    expect(result.ok && result.found).toBe(true);
    if (!result.ok || !result.found) return;
    expect(result.hitCount).toBeGreaterThan(0);
  });

  test('returns FIND_QUERY_INVALID for bad regex', async () => {
    const sourcesJar = makeJar({ 'com/example/Bad.java': 'public class Bad {}' });
    const binaryJar = makeJar({ 'com/example/Bad.class': '\xca\xfe\xba\xbe' });

    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: sourcesJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: '[invalid regex',
      regex: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FIND_QUERY_INVALID');
  });

  test('returns ARTIFACT_NOT_FOUND when selector misses', async () => {
    const binaryJar = makeJar({ 'com/example/X.class': '\xca\xfe\xba\xbe' });
    const artifact = makeArtifact({ jarPath: binaryJar });
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { coordinates: { group: 'org.missing', name: 'absent', version: '9.9' } },
      query: 'anything',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.found).toBe(false);
    if (result.found) return;
    expect(result.code).toBe('ARTIFACT_NOT_FOUND');
  });

  test('falls back to CFR decompilation when sources JAR absent (no Java call — skips class)', async () => {
    // A JAR with no sourcesJarPath; decompilation will fail silently (no Java binary in test env typically)
    // We just verify the function doesn't throw and returns found=true.
    const binaryJar = makeJar({ 'com/example/NoCfr.class': '\xca\xfe\xba\xbe' });
    const artifact = makeArtifact({ jarPath: binaryJar, sourcesJarPath: null });
    // Non-external origin so resolveSourcesJar is skipped
    artifact.origin = 'local-file';
    const output = makeOutput(artifact);

    const result = await searchInArtifactFromOutput(output, {
      selector: { jarPath: binaryJar },
      query: 'anything',
    });

    // Either found=true (CFR worked) or found=true with 0 hits (class skipped). Must not throw.
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// format helpers
// ---------------------------------------------------------------------------

describe('formatSearchInArtifactText', () => {
  test('includes className and hit line in compact output', async () => {
    const { formatSearchInArtifactText } = await import('./text-format/format-search-in-artifact.js');

    const mockResult = {
      ok: true as const,
      found: true as const,
      artifact: { group: 'com.example', name: 'lib', version: '1.0', jarPath: '/lib.jar' },
      query: 'greet',
      regex: false,
      classesScanned: 2,
      totalMatches: 1,
      hitCount: 1,
      truncated: false,
      hits: [
        {
          className: 'com.example.Hello',
          sourceAvailable: true,
          totalMatches: 1,
          hits: [
            {
              line: 5,
              column: 9,
              matchedText: 'greet',
              contextBefore: [],
              contextAfter: [],
            },
          ],
        },
      ],
    };

    const text = formatSearchInArtifactText(mockResult);
    expect(text).toContain('com.example.Hello');
    expect(text).toContain('5:9');
    expect(text).toContain('greet');
  });
});
