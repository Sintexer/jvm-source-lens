import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import { pickResolvedConfiguration } from './extractor/pick-classpath.js';
import type { ResolutionOutput, ResolvedArtifact } from './resolvers/resolution-output.js';
import { searchClassesAcrossModules } from './search-classes.js';
import { formatSearchClassesText } from './text-format/format-search.js';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-union-')));
const prevCache = process.env.JVMSRC_CACHE_ROOT;
beforeAll(() => {
  process.env.JVMSRC_CACHE_ROOT = path.join(dir, 'cache');
});
afterAll(() => {
  if (prevCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
  else process.env.JVMSRC_CACHE_ROOT = prevCache;
  fs.rmSync(dir, { recursive: true, force: true });
});

const bytes = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);
const jar = (name: string, classes: string[]): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, zipSync(Object.fromEntries(classes.map((c) => [c, bytes]))));
  return p;
};
const art = (name: string, version: string, jarPath: string): ResolvedArtifact => ({
  group: 'g',
  name,
  version,
  type: 'jar',
  jarPath,
  sourcesJarPath: null,
  origin: 'external',
  direct: true,
});

const shared = jar('shared.jar', ['org/x/Shared.class']);
const mapper1 = jar('mapper-1.jar', ['org/x/Mapper.class']);
const mapper2 = jar('mapper-2.jar', ['org/x/Mapper.class']);
const onlyWorker = jar('only.jar', ['org/x/OnlyWorker.class']);

const output: ResolutionOutput = {
  schemaVersion: '1.1',
  resolvedAt: '2020-01-01T00:00:00Z',
  buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
  projectRoot: dir,
  modules: [
    { name: 'root', path: dir, configurations: [] },
    {
      name: ':app',
      path: path.join(dir, 'app'),
      configurations: [
        { name: 'compileClasspath', scope: 'compile', artifacts: [art('shared', '1', shared), art('mapper', '1.0', mapper1)] },
      ],
    },
    {
      name: ':worker',
      path: path.join(dir, 'worker'),
      configurations: [
        {
          name: 'compileClasspath',
          scope: 'compile',
          artifacts: [art('shared', '1', shared), art('mapper', '2.0', mapper2), art('only', '1', onlyWorker)],
        },
      ],
    },
  ],
  errors: [],
};

describe('search without modulePath on a multi-module build', () => {
  test('pick-classpath reports the config-scoped ambiguity this path handles', () => {
    const picked = pickResolvedConfiguration(output, {});
    expect(picked.ok).toBe(false);
    if (!picked.ok) {
      expect(picked.error.code).toBe('MODULE_AMBIGUOUS');
    }
  });

  const run = (query: string) => {
    const r = searchClassesAcrossModules({ projectRoot: dir, query }, output, [':app', ':worker'], query, 50);
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  test('a class only one module has is found and attributed to it', () => {
    const r = run('OnlyWorker');
    expect(r.hits.map((h) => [h.className, h.modules])).toEqual([['org.x.OnlyWorker', [':worker']]]);
  });

  test('the same artifact in several modules is one hit listing all modules', () => {
    const r = run('Shared');
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.modules).toEqual([':app', ':worker']);
  });

  test('the same FQN at different versions stays as separate hits, told apart by version', () => {
    const r = run('Mapper');
    expect(r.hits.map((h) => [h.coordinates.version, h.modules])).toEqual([
      ['1.0', [':app']],
      ['2.0', [':worker']],
    ]);
    const text = formatSearchClassesText({ query: 'Mapper', totalMatches: r.totalMatches, hits: r.hits, limit: 50 });
    expect(text).toContain('org.x.Mapper  mapper:1.0  [:app]');
    expect(text).toContain('org.x.Mapper  mapper:2.0  [:worker]');
  });
});

describe('search_in_artifact without modulePath', () => {
  test('differing versions across modules surface as ARTIFACT_AMBIGUOUS, not a module error', async () => {
    const { searchInArtifactFromOutput } = await import('./search-in-artifact.js');
    const r = await searchInArtifactFromOutput(output, {
      selector: { coordinates: { group: 'g', name: 'mapper' } },
      query: 'x',
    });
    expect(r.ok).toBe(true);
    if (r.ok && !r.found) {
      expect(r.code).toBe('ARTIFACT_AMBIGUOUS');
      expect(r.candidates?.map((c) => c.version).sort()).toEqual(['1.0', '2.0']);
    } else {
      throw new Error(`expected ARTIFACT_AMBIGUOUS, got ${JSON.stringify(r).slice(0, 200)}`);
    }
  });

  test('an unknown artifact is ARTIFACT_NOT_FOUND', async () => {
    const { searchInArtifactFromOutput } = await import('./search-in-artifact.js');
    const r = await searchInArtifactFromOutput(output, { selector: { coordinates: { group: 'g', name: 'nope' } }, query: 'x' });
    expect(r.ok && !r.found && r.code).toBe('ARTIFACT_NOT_FOUND');
  });
});
