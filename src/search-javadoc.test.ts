import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { searchInArtifactFromOutput } from './search-in-artifact.js';
import { searchJavadocJar } from './search-javadoc.js';
import type { ResolutionOutput, ResolvedArtifact } from './resolvers/resolution-output.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-javadoc-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const zip = (name: string, files: Record<string, string>) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  return p;
};
const page = (body: string) =>
  `<html><script>needle()</script><body><div class="block">${body}</div><p>Second line.</p></body></html>`;

test('shouldFindProseOnlyInPagesOfBinaryClassesWhenSearchingDocs', async () => {
  const jar = zip('docs.jar', {
    'a/Foo.html': page('Connections are pooled &amp; needle reused.'),
    'mod.x/a/Bar.html': page('Nothing here.'),
    'a/Foo.Inner.html': page('Inner needle.'),
    'a/Stray.html': page('stray needle'),
    'a/package-summary.html': page('package needle'),
  });
  const r = await searchJavadocJar(jar, ['a.Foo', 'a.Foo$Inner', 'a.Bar'], { query: 'needle', maxHits: 20, contextLines: 1, maxClasses: 500 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.hits.map(h => h.className)).toEqual(['a.Foo', 'a.Foo$Inner']);
  // Column 26 only holds when `&amp;` is decoded and the script text is dropped.
  expect(r.hits[0]!.hits[0]).toMatchObject({ line: 1, column: 26, matchedText: 'needle', contextAfter: ['Second line.'] });
  expect(r.classesScanned).toBe(3);
});

test('shouldIgnoreScriptTextAndRejectRegexWhenSearchingDocs', async () => {
  const jar = zip('docs.jar', { 'a/Foo.html': page('plain') });
  const r = await searchJavadocJar(jar, ['a.Foo'], { query: 'needle', maxHits: 5, contextLines: 0, maxClasses: 10 });
  expect(r).toMatchObject({ ok: true, hits: [] });
  const bad = await searchJavadocJar(jar, ['a.Foo'], { query: 'n.*', regex: true, maxHits: 5, contextLines: 0, maxClasses: 10 });
  expect(bad).toMatchObject({ ok: false, error: { code: 'FIND_QUERY_INVALID' } });
});

test('shouldFailWhenDocsArchiveIsInvalidAndSkipOversizedPage', async () => {
  const bad = path.join(dir, 'bad.jar');
  fs.writeFileSync(bad, 'nope');
  expect(await searchJavadocJar(bad, ['a.Foo'], { query: 'x', maxHits: 5, contextLines: 0, maxClasses: 10 })).toMatchObject({ ok: false, error: { code: 'ZIP_READ_ERROR' } });
  const big = zip('big.jar', { 'a/Foo.html': page('needle ' + 'x'.repeat(3 * 1024 * 1024)) });
  const r = await searchJavadocJar(big, ['a.Foo'], { query: 'needle', maxHits: 5, contextLines: 0, maxClasses: 10 });
  expect(r).toMatchObject({ ok: true, hits: [] });
});

test('shouldSearchJavadocJarInsteadOfSourceWhenDocsRequested', async () => {
  const jarPath = zip('lib.jar', { 'a/Foo.class': '' });
  const docs = zip('lib-javadoc.jar', { 'a/Foo.html': page('Pool needle docs.') });
  const artifact: ResolvedArtifact = { group: 'g', name: 'lib', version: '1', type: 'jar', origin: 'external', direct: true, jarPath, sourcesJarPath: null };
  const out: ResolutionOutput = { schemaVersion: '1.1', resolvedAt: '', buildSystem: { type: 'gradle', version: '', wrapper: false },
    projectRoot: dir, errors: [], modules: [{ name: 'app', path: dir, configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts: [artifact] }] }] };
  const calls: string[] = [];
  const r = await searchInArtifactFromOutput(out, { selector: { jarPath }, query: 'needle', docs: true,
    resolveJavadocJarFn: async (_root, c, moduleName) => { calls.push(`${c.name}@${moduleName}`); return { ok: true, javadocJarPath: docs }; } });
  expect(calls).toEqual(['lib@app']);
  expect(r).toMatchObject({ ok: true, found: true, docs: true, hitCount: 1, hits: [{ className: 'a.Foo', sourceAvailable: false }] });
  const none = await searchInArtifactFromOutput(out, { selector: { jarPath }, query: 'needle', docs: true,
    resolveJavadocJarFn: async () => ({ ok: true, javadocJarPath: null }) });
  expect(none).toMatchObject({ ok: false, error: { code: 'DOCS_NOT_FOUND' } });
  const fail = await searchInArtifactFromOutput(out, { selector: { jarPath }, query: 'needle', docs: true,
    resolveJavadocJarFn: async () => ({ ok: false, message: 'offline' }) });
  expect(fail).toMatchObject({ ok: false, error: { code: 'DOCS_RESOLVE_FAILED' } });
});
