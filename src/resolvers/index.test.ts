import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { DependencyResolver } from './base.js';
import {
  allResolvers,
  detectResolver,
  GradleResolver,
  MavenResolver,
  registerResolverForTesting,
  resolverById,
  UnsupportedProjectError,
} from './index.js';

function makeFakeResolver(marker = 'fake.build'): DependencyResolver {
  return {
    id: 'fake',
    displayName: 'Fake',
    rootHint: marker,
    detect: (projectRoot) => fs.existsSync(path.join(projectRoot, marker)),
    findBuildRoot: (start) => {
      let dir = path.resolve(start);
      for (;;) {
        if (fs.existsSync(path.join(dir, marker))) {
          return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          return null;
        }
        dir = parent;
      }
    },
    cacheInputs: () => ({ files: [marker], env: [] }),
    isImmutableArtifact: () => false,
    resolve: async (projectRoot) => ({
      ok: true,
      output: {
        schemaVersion: '1.2',
        resolvedAt: '2026-01-01T00:00:00Z',
        buildSystem: { type: 'fake', version: '1.0', wrapper: false },
        projectRoot,
        modules: [],
        errors: [],
      },
    }),
    resolveSourcesJar: async () => ({ ok: true, sourcesJarPath: null }),
  };
}

describe('resolver registry', () => {
  test('exposes built-in GradleResolver and MavenResolver metadata through allResolvers and resolverById', () => {
    const resolvers = allResolvers();
    expect(resolvers.map((r) => r.id)).toEqual(['gradle', 'maven']);
    const gradle = resolverById('gradle');
    expect(gradle).toBeInstanceOf(GradleResolver);
    expect(gradle?.displayName).toBe('Gradle');
    expect(gradle?.rootHint).toBe('gradlew or settings.gradle(.kts)');
    const maven = resolverById('maven');
    expect(maven).toBeInstanceOf(MavenResolver);
    expect(maven?.displayName).toBe('Maven');
    expect(maven?.rootHint).toBe('pom.xml');
    expect(resolverById('nonexistent')).toBeUndefined();
  });

  test('prefers GradleResolver when a directory carries both build.gradle and pom.xml', () => {
    const dual = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-dual-'));
    try {
      fs.writeFileSync(path.join(dual, 'build.gradle'), '');
      fs.writeFileSync(path.join(dual, 'pom.xml'), '<project/>');
      expect(detectResolver(dual)).toBeInstanceOf(GradleResolver);
    } finally {
      fs.rmSync(dual, { recursive: true, force: true });
    }
  });

  test('UnsupportedProjectError lists registered resolver displayNames', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-noreg-'));
    try {
      expect(() => detectResolver(empty)).toThrow(UnsupportedProjectError);
      expect(() => detectResolver(empty)).toThrow(
        `No supported build system found in ${empty}. Currently supported: Gradle, Maven. Contributions welcome.`,
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('registerResolverForTesting prepends a resolver and restores cleanly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-fakereg-'));
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-fakereg-empty-'));
    fs.writeFileSync(path.join(dir, 'fake.build'), '');
    const fake = makeFakeResolver();
    const restore = registerResolverForTesting(fake);
    try {
      expect(allResolvers().map((r) => r.id)).toEqual(['fake', 'gradle', 'maven']);
      expect(resolverById('fake')).toBe(fake);
      expect(detectResolver(dir)).toBe(fake);
      expect(() => detectResolver(empty)).toThrow('Currently supported: Fake, Gradle, Maven.');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(empty, { recursive: true, force: true });
    }
    expect(allResolvers().map((r) => r.id)).toEqual(['gradle', 'maven']);
    expect(resolverById('fake')).toBeUndefined();
  });
});
