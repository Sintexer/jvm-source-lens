import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import {
  collectLocalArtifactJarPaths,
  computeLocalArtifactDigest,
  gradleUserHome,
  isGradleManagedJar,
} from './local-artifact-digest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArtifact(override: Partial<ResolvedArtifact>): ResolvedArtifact {
  return {
    group: 'com.example',
    name: 'lib',
    version: '1.0.0',
    type: 'jar',
    jarPath: null,
    sourcesJarPath: null,
    origin: 'external',
    direct: true,
    ...override,
  };
}

function makeOutput(artifacts: ResolvedArtifact[]): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2026-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '9.0', wrapper: true },
    projectRoot: '/project',
    modules: [
      {
        name: ':app',
        path: '/project/app',
        configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }],
      },
    ],
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// isGradleManagedJar
// ---------------------------------------------------------------------------

describe('isGradleManagedJar', () => {
  test('returns true for a path inside GRADLE_USER_HOME/caches', () => {
    const gradle = gradleUserHome();
    const jar = path.join(gradle, 'caches', 'modules-2', 'files-2.1', 'org', 'lib', '1.0', 'lib.jar');
    expect(isGradleManagedJar(jar)).toBe(true);
  });

  test('returns false for a path in ~/.m2 (mavenLocal)', () => {
    const jar = path.join(os.homedir(), '.m2', 'repository', 'com', 'example', 'lib', '1.0', 'lib.jar');
    expect(isGradleManagedJar(jar)).toBe(false);
  });

  test('returns false for an arbitrary temp-dir path', () => {
    const jar = path.join(os.tmpdir(), 'local-repo', 'com', 'example', 'lib', '1.0.0', 'lib.jar');
    expect(isGradleManagedJar(jar)).toBe(false);
  });

  test('respects GRADLE_USER_HOME env override', () => {
    const orig = process.env.GRADLE_USER_HOME;
    const customHome = path.join(os.tmpdir(), 'custom-gradle-home');
    process.env.GRADLE_USER_HOME = customHome;
    try {
      const inside = path.join(customHome, 'caches', 'lib.jar');
      const outside = path.join(os.homedir(), '.gradle', 'caches', 'lib.jar');
      expect(isGradleManagedJar(inside)).toBe(true);
      expect(isGradleManagedJar(outside)).toBe(false);
    } finally {
      if (orig === undefined) {
        delete process.env.GRADLE_USER_HOME;
      } else {
        process.env.GRADLE_USER_HOME = orig;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// collectLocalArtifactJarPaths
// ---------------------------------------------------------------------------

describe('collectLocalArtifactJarPaths', () => {
  test('returns empty array for output with no external artifacts', () => {
    const out = makeOutput([makeArtifact({ origin: 'interproject', jarPath: null })]);
    expect(collectLocalArtifactJarPaths(out)).toEqual([]);
  });

  test('excludes Gradle-managed jars', () => {
    const gradle = gradleUserHome();
    const jar = path.join(gradle, 'caches', 'lib.jar');
    const out = makeOutput([makeArtifact({ jarPath: jar })]);
    expect(collectLocalArtifactJarPaths(out)).toEqual([]);
  });

  test('includes non-Gradle external jars', () => {
    const jar = path.join(os.tmpdir(), 'local-repo', 'lib.jar');
    const out = makeOutput([makeArtifact({ jarPath: jar })]);
    const paths = collectLocalArtifactJarPaths(out);
    expect(paths).toContain(path.resolve(jar));
  });

  test('deduplicates jars that appear in multiple configurations', () => {
    const jar = path.join(os.tmpdir(), 'local-repo', 'lib.jar');
    const art = makeArtifact({ jarPath: jar });
    const out: ResolutionOutput = {
      schemaVersion: '1.1',
      resolvedAt: '2026-01-01T00:00:00Z',
      buildSystem: { type: 'gradle', version: '9.0', wrapper: true },
      projectRoot: '/project',
      modules: [
        {
          name: ':app',
          path: '/project/app',
          configurations: [
            { name: 'compileClasspath', scope: 'compile', artifacts: [art] },
            { name: 'runtimeClasspath', scope: 'runtime', artifacts: [art] },
          ],
        },
      ],
      errors: [],
    };
    const paths = collectLocalArtifactJarPaths(out);
    expect(paths).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeLocalArtifactDigest
// ---------------------------------------------------------------------------

describe('computeLocalArtifactDigest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-lad-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('returns "none" when output has no local artifacts', () => {
    const out = makeOutput([]);
    expect(computeLocalArtifactDigest(out)).toBe('none');
  });

  test('returns a 64-char hex string when local artifacts are present', () => {
    const jarPath = path.join(tmpDir, 'lib.jar');
    fs.writeFileSync(jarPath, 'fake jar content');
    const out = makeOutput([makeArtifact({ jarPath })]);
    const digest = computeLocalArtifactDigest(out);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('digest changes when jar content changes', () => {
    const jarPath = path.join(tmpDir, 'lib.jar');
    fs.writeFileSync(jarPath, 'version 1');
    const out = makeOutput([makeArtifact({ jarPath })]);
    const d1 = computeLocalArtifactDigest(out);
    fs.writeFileSync(jarPath, 'version 2');
    const d2 = computeLocalArtifactDigest(out);
    expect(d1).not.toBe(d2);
  });

  test('digest changes when jar is absent vs present', () => {
    const jarPath = path.join(tmpDir, 'lib.jar');
    const out = makeOutput([makeArtifact({ jarPath })]);
    // Absent — file does not exist yet.
    const dAbsent = computeLocalArtifactDigest(out);
    fs.writeFileSync(jarPath, 'content');
    const dPresent = computeLocalArtifactDigest(out);
    expect(dAbsent).not.toBe(dPresent);
  });

  test('digest is stable when jar content does not change', () => {
    const jarPath = path.join(tmpDir, 'lib.jar');
    fs.writeFileSync(jarPath, 'stable content');
    const out = makeOutput([makeArtifact({ jarPath })]);
    expect(computeLocalArtifactDigest(out)).toBe(computeLocalArtifactDigest(out));
  });
});
