import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import {
  canonicalizeClassName,
  normalizeClassNameSyntax,
  resolveClassScopeOrError,
} from './canonicalize-class-name.js';

const bytes = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);

// describe bodies run at collection time, so the fixtures dir must exist before beforeAll.
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-canon-')));
const prevCache = process.env.JVMSRC_CACHE_ROOT;

beforeAll(() => {
  process.env.JVMSRC_CACHE_ROOT = path.join(dir, 'cache');
});
afterAll(() => {
  if (prevCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
  else process.env.JVMSRC_CACHE_ROOT = prevCache;
  fs.rmSync(dir, { recursive: true, force: true });
});

function jar(name: string, classes: string[]): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, zipSync(Object.fromEntries(classes.map((c) => [c, bytes]))));
  return p;
}

function artifact(name: string, jarPath: string, version = '1.0'): ResolvedArtifact {
  return {
    group: 'g',
    name,
    version,
    type: 'jar',
    jarPath,
    sourcesJarPath: null,
    origin: 'external',
    direct: true,
  };
}

function output(modules: Record<string, ResolvedArtifact[]>): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: dir,
    modules: Object.entries(modules).map(([name, artifacts]) => ({
      name,
      path: path.join(dir, name.replace(/^:/, '')),
      configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }],
    })),
    errors: [],
  };
}

const canon = (out: ResolutionOutput, raw: string, scope = {}) => {
  const r = canonicalizeClassName(dir, out, raw, scope);
  return r.ok ? r.className : r.error;
};

describe('normalizeClassNameSyntax', () => {
  test.each([
    ['com.example.Foo', 'com.example.Foo'],
    ['  com.example.Foo.class ', 'com.example.Foo'],
    ['com.example.Foo.java', 'com.example.Foo'],
    ['com/example/Foo.class', 'com.example.Foo'],
    ['com\\example\\Foo', 'com.example.Foo'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeClassNameSyntax(raw)).toBe(expected);
  });
});

describe('canonicalizeClassName', () => {
  const jarA = jar('a.jar', ['com/example/Foo.class', 'com/example/Outer.class', 'com/example/Outer$Inner.class']);
  const jarB = jar('b.jar', ['org/other/Foo.class', 'org/other/Bar.class']);
  const single = output({ root: [artifact('a', jarA)] });
  const both = output({ root: [artifact('a', jarA), artifact('b', jarB)] });

  test('leaves an existing FQN alone', () => {
    expect(canon(single, 'com.example.Foo')).toBe('com.example.Foo');
  });

  test('strips file suffixes', () => {
    expect(canon(single, 'com/example/Foo.class')).toBe('com.example.Foo');
  });

  test('dotted nested name becomes $ form', () => {
    expect(canon(single, 'com.example.Outer.Inner')).toBe('com.example.Outer$Inner');
    expect(canon(single, 'com.example.Outer$Inner')).toBe('com.example.Outer$Inner');
  });

  test('unique simple name is resolved and reports resolvedFrom', () => {
    const r = canonicalizeClassName(dir, single, 'Outer', {});
    expect(r).toEqual({ ok: true, className: 'com.example.Outer', resolvedFrom: 'Outer' });
  });

  test('simple nested name without package', () => {
    expect(canon(single, 'Outer.Inner')).toBe('com.example.Outer$Inner');
  });

  test('several matches return a pick list as INVALID_FQN', () => {
    const r = canonicalizeClassName(dir, both, 'Foo', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_FQN');
      expect(r.error.message).toContain('com.example.Foo, org.other.Foo');
      expect(r.error.message).toContain('Retry with className');
    }
  });

  test('unknown names pass through for downstream CLASS_NOT_FOUND', () => {
    expect(canon(single, 'com.example.Missing')).toBe('com.example.Missing');
    expect(canon(single, 'Nope')).toBe('Nope');
  });

  test('invalid syntax passes through for downstream INVALID_FQN', () => {
    expect(canon(single, 'not a name')).toBe('not a name');
  });
});

describe('resolveClassScopeOrError', () => {
  const jarA = jar('s1.jar', ['com/example/Foo.class']);
  const jarB = jar('s2.jar', ['com/example/Foo.class']);

  test('same artifact on several modules is not ambiguous', () => {
    const out = output({ ':app': [artifact('lib', jarA)], ':worker': [artifact('lib', jarA)] });
    const r = resolveClassScopeOrError(dir, out, { className: 'Foo' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.className).toBe('com.example.Foo');
      expect(r.modulePath).toBe(':app');
    }
  });

  test('different versions per module give a retry-ready message', () => {
    const out = output({
      ':app': [artifact('lib', jarA, '1.2.0')],
      ':worker': [artifact('lib', jarB, '1.4.1')],
    });
    const r = resolveClassScopeOrError(dir, out, { className: 'com.example.Foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_AMBIGUOUS');
      expect(r.error.message).toContain(':app (g:lib:1.2.0)');
      expect(r.error.message).toContain(':worker (g:lib:1.4.1)');
      expect(r.error.message).toContain('Retry with modulePath=":app" or modulePath=":worker"');
    }
  });
});
