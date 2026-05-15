import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ensureClassSearchIndex } from '../../src/class-search/ensure-class-search-index.js';
import { matchAndRankClassSearch } from '../../src/class-search/match-class-search.js';
import { extractExternalClassSource } from '../../src/extractor/extract-external-class-source.js';
import type { ResolutionOutput, ResolvedArtifact } from '../../src/resolvers/resolution-output.js';

/**
 * Fast regression tests for the committed multimodule fixture under `test/fixtures/gradle-smoke`.
 * Uses synthetic `ResolutionOutput` shaped like Gradle’s JSON — no `gradlew`, no resolution cache miss path on Gradle.
 */
const repoRoot = path.resolve(import.meta.dir, '../..');
const fixtureRoot = path.join(repoRoot, 'test/fixtures/gradle-smoke');
const corePath = path.join(fixtureRoot, 'core');
const appPath = path.join(fixtureRoot, 'app');
const coreJava = path.join(corePath, 'src/main/java/com/smoke/Core.java');

function interCoreArtifact(): ResolvedArtifact {
  return {
    group: 'gradle-smoke',
    name: 'core',
    version: null,
    type: 'project',
    jarPath: null,
    sourcesJarPath: null,
    origin: 'interproject',
    direct: true,
    interproject: { moduleName: ':core', modulePath: corePath },
  };
}

function smokeResolutionOutput(): ResolutionOutput {
  return {
    schemaVersion: '1.0',
    resolvedAt: '2026-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '9.0', wrapper: true },
    projectRoot: fixtureRoot,
    modules: [
      {
        name: ':core',
        path: corePath,
        configurations: [
          { name: 'compileClasspath', scope: 'compile', artifacts: [] },
        ],
      },
      {
        name: ':app',
        path: appPath,
        configurations: [
          {
            name: 'compileClasspath',
            scope: 'compile',
            artifacts: [interCoreArtifact()],
          },
        ],
      },
    ],
    errors: [],
  };
}

const fixtureReady = fs.existsSync(coreJava);

describe.skipIf(!fixtureReady)('gradle-smoke fixture (synthetic resolution, no Gradle)', () => {
  let prevCache: string | undefined;
  let tmpCache: string;

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-smoke-fixture-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
  });

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    try {
      fs.rmSync(tmpCache, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('extractExternalClassSource reads inter-project Core.java from :app classpath', async () => {
    const out = smokeResolutionOutput();
    const got = await extractExternalClassSource(out, {
      className: 'com.smoke.Core',
      modulePath: ':app',
    });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.source).toContain('public class Core');
    expect(got.sourceAvailable).toBe(true);
    expect(got.provenance.kind).toBe('interproject');
  });

  test('class search index matches method name from source enrichment', () => {
    const out = smokeResolutionOutput();
    const picked = out.modules.find((m) => m.name === ':app');
    const cfg = picked?.configurations.find((c) => c.name === 'compileClasspath');
    expect(picked).toBeDefined();
    expect(cfg).toBeDefined();
    if (!picked || !cfg) {
      return;
    }

    const ensured = ensureClassSearchIndex(fixtureRoot, out, {
      module: picked,
      configuration: cfg,
      includeTest: false,
    });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) {
      return;
    }

    expect(ensured.file.meta.indexFormatVersion).toBe(2);
    expect(ensured.file.meta.sourceEnrichedEntries).toBeGreaterThanOrEqual(1);

    const coreEntry = ensured.file.entries.find((e) => e.className === 'com.smoke.Core');
    expect(coreEntry).toBeDefined();
    expect(coreEntry!.searchText).toContain('hello');

    const byMethod = matchAndRankClassSearch(ensured.file.entries, 'hello', 20);
    expect(byMethod.totalMatches).toBeGreaterThanOrEqual(1);
    expect(byMethod.hits.some((h) => h.className === 'com.smoke.Core')).toBe(true);

    const byFqn = matchAndRankClassSearch(ensured.file.entries, 'com.smoke.Core', 20);
    expect(byFqn.hits.some((h) => h.className === 'com.smoke.Core')).toBe(true);
  });
});
