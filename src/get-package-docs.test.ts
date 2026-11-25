import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { getPackageDocs, lookupPackageDocs } from './get-package-docs.js';
import type { ResolutionOutput, ResolvedArtifact, ResolvedModule } from './resolvers/base.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'package-docs-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function disk(rel: string, text: string) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}
function jar(name: string, files: Record<string, string>) {
  const path = join(root, name + '.jar');
  writeFileSync(path, zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  return path;
}
function external(name: string, files: Record<string, string>, version = '1'): ResolvedArtifact {
  return { origin: 'external', type: 'jar', group: 'g', name, version, direct: true,
    jarPath: jar(name + version, files) };
}
function mod(name: string, artifacts: ResolvedArtifact[] = []): ResolvedModule {
  return { name, path: join(root, name), configurations: [
    { name: 'compileClasspath', scope: 'compile', artifacts },
    { name: 'testCompileClasspath', scope: 'test-compile', artifacts },
  ] };
}
function output(...modules: ResolvedModule[]): ResolutionOutput {
  return { projectRoot: root, resolvedAt: '', schemaVersion: '1.2', modules, errors: [],
    buildSystem: { type: 'gradle', wrapper: false, version: '' } };
}
const opts = { packageName: 'a.b' };

test('split package keeps module and sibling docs and types separate, with exact package and declaration matching', async () => {
  const lib = mod('lib');
  const edge: ResolvedArtifact = { group: 'g', name: 'lib', version: null, type: 'project', origin: 'interproject',
    direct: true, jarPath: null, interproject: { moduleName: lib.name, modulePath: lib.path } };
  disk('app/src/main/java/a/b/package-info.java', '/** App docs. */\n@Deprecated\npackage a.b;');
  disk('app/src/main/java/a/b/package.html', 'Not preferred');
  disk('app/src/main/java/a/b/A.java', 'package a.b; /** First\n * type. */ public class A { class Inner {} } record Other() {}');
  disk('app/src/main/java/a/b/Wrong.java', 'package other; class Wrong {}');
  disk('app/src/main/java/a/b/sub/Sub.java', 'package a.b.sub; class Sub {}');
  disk('lib/src/main/java/a/b/package.html', '<head>Ignored</head><BODY><script>bad()</script>Legacy &amp; docs.</BODY>');
  disk('lib/src/main/java/a/b/A.java', 'package a.b; class A {}');
  const hit = await lookupPackageDocs(output(mod('app', [edge, edge]), lib), { ...opts, modulePath: 'app/src/Main.java' });
  expect(hit.ok).toBe(true);
  if (!hit.ok) throw Error(hit.error.message);
  expect(hit.owners).toHaveLength(2);
  expect(hit.owners[0]).toMatchObject({ provenance: { moduleName: 'app' }, description: 'App docs.',
    types: [{ name: 'A', summary: 'First type.' }, { name: 'Other', summary: null }] });
  expect(hit.owners[1]).toMatchObject({ provenance: { moduleName: 'lib', coordinates: { group: 'g' } },
    description: 'Legacy & docs.', types: [{ name: 'A', summary: null }] });
});

test('sources fetched only for owning binary, summaries match compiled types, not source-only or nested types', async () => {
  const bin = external('lib', { 'a/b/A.class': '', 'a/b/Extra.class': '', 'a/b/Hidden$Inner.class': '', 'a/b/package-info.class': '' });
  const other = external('other', { 'a/b/sub/C.class': '', 'a.b/Misplaced.class': '', 'a/b/sub.C.class': '' });
  const sources = jar('sources', { 'a/b/package-info.java': '/** Archive. */ package a.b;',
    'a/b/A.java': 'package a.b; class A {} /** Secondary. */ class Extra {} class Ghost {}',
    'other/package.html': 'Unrelated' });
  const requested: unknown[] = [];
  const hit = await lookupPackageDocs(output(mod('empty'), mod('app', [other, bin])), opts, async c => {
    requested.push(c); return { ok: true, sourcesJarPath: sources };
  });
  expect(requested).toEqual([{ group: 'g', name: 'lib', version: '1' }]);
  expect(hit).toMatchObject({ ok: true, owners: [{ description: 'Archive.', docsPath: 'a/b/package-info.java',
    provenance: { jarPath: bin.jarPath, sourcesJarPath: sources },
    types: [{ name: 'A', summary: null }, { name: 'Extra', summary: 'Secondary.' }] }] });
});

test('ambiguous versions never trigger downloads; explicit module and missing configuration do not widen scope', async () => {
  const out = output(...['1', '2'].map(v => mod('app' + v, [external('lib', { 'a/b/A.class': '' }, v)])));
  const fetch = async () => { throw Error('unexpected fetch'); };
  expect(await lookupPackageDocs(out, opts, fetch)).toMatchObject({ ok: false, error: { code: 'MODULE_AMBIGUOUS', modulePaths: ['app1', 'app2'] } });
  expect(await lookupPackageDocs(out, { ...opts, modulePath: 'missing' }, fetch)).toMatchObject({ error: { code: 'MODULE_NOT_FOUND' } });
  expect(await lookupPackageDocs(out, { ...opts, configuration: 'missing' }, fetch)).toMatchObject({ error: { code: 'CONFIGURATION_NOT_FOUND' } });
  expect(await lookupPackageDocs(out, { ...opts, modulePath: 'app2/src/main/X.java' })).toMatchObject({ owners: [{ provenance: { coordinates: { version: '2' } } }] });
});

test('test source file infers test scope unless explicitly disabled; empty/subpackage alone does not own package', async () => {
  const file = disk('app/src/test/java/a/b/Test.java', 'package a.b; class Test {}');
  disk('app/src/main/java/a/b/sub/package.html', 'Not the parent');
  const out = output(mod('app'));
  expect(await lookupPackageDocs(out, { ...opts, modulePath: file, includeTest: false })).toMatchObject({ error: { code: 'DOCS_NOT_FOUND' } });
  expect(await lookupPackageDocs(out, { ...opts, modulePath: file })).toMatchObject({ owners: [{ description: null, types: [{ name: 'Test' }] }] });
});

test('invalid dot paths, separators and absolute paths fail before build resolution', async () => {
  for (const packageName of ['', 'a..b', '../a', 'a/b', 'a\\b', '/etc', 'a.']) {
    expect(await getPackageDocs({ projectRoot: root, packageName })).toMatchObject({ ok: false, error: { code: 'INVALID_FQN' } });
  }
});

test('missing publication leaves a binary type index; failed fetch is not reported as missing', async () => {
  const out = output(mod('app', [external('lib', { 'a/b/A.class': '' })]));
  expect(await lookupPackageDocs(out, opts, async () => ({ ok: true, sourcesJarPath: null }))).toMatchObject({
    owners: [{ description: null, docsPath: null, types: [{ name: 'A', summary: null }] }] });
  expect(await lookupPackageDocs(out, opts, async () => ({ ok: false, message: 'repository offline' }))).toMatchObject({
    error: { code: 'DOCS_RESOLVE_FAILED', message: expect.stringContaining('offline') } });
});

test('inflated package entries are bounded before reading; huge unrelated entries are skipped', async () => {
  const lib = external('lib', { 'a/b/A.class': '' });
  const out = output(mod('app', [lib]));
  const large = 'x'.repeat(2 * 1024 * 1024);
  lib.sourcesJarPath = jar('sources', { 'a/b/package.html': 'Short', 'a/b/sub/package.html': large });
  expect(await lookupPackageDocs(out, opts)).toMatchObject({ owners: [{ description: 'Short' }] });
  lib.sourcesJarPath = jar('sources', { 'a/b/package.html': large });
  expect(await lookupPackageDocs(out, opts)).toMatchObject({ ok: false, error: { code: 'ZIP_READ_ERROR' } });
});

test('symlinked package directory cannot expose files outside the module', async () => {
  disk('elsewhere/package.html', 'Secret');
  mkdirSync(join(root, 'app/src/main/java/a'), { recursive: true });
  symlinkSync(join(root, 'elsewhere'), join(root, 'app/src/main/java/a/b'));
  expect(await lookupPackageDocs(output(mod('app')), opts)).toMatchObject({ ok: false });
});

test('local-file JAR does not fetch sources even when it owns a type; corrupt JAR is not an empty package', async () => {
  const a: ResolvedArtifact = { ...external('local', { 'a/b/Foo.class': '' }), origin: 'local-file', type: 'local-file' };
  const out = output(mod('app', [a]));
  expect(await lookupPackageDocs(out, opts, async () => { throw Error('unexpected'); })).toMatchObject({
    owners: [{ provenance: { kind: 'local-file' }, types: [{ name: 'Foo', summary: null }] }] });
  writeFileSync(a.jarPath!, 'broken');
  expect(await lookupPackageDocs(out, opts)).toMatchObject({ error: { code: 'ZIP_READ_ERROR', jarPath: a.jarPath } });
});

test('Kotlin declarations, not files or functions, contribute one-line summaries', async () => {
  disk('app/src/main/kotlin/a/b/Several.kt', `package a.b\n/** Original\n * KDoc. */\nclass Thing { class Inner }\ninterface Extra\nfun f() {}`);
  expect(await lookupPackageDocs(output(mod('app')), opts)).toMatchObject({ owners: [{
    types: [{ name: 'Extra', summary: null }, { name: 'Thing', summary: 'Original KDoc.' }],
  }] });
});

test('prose is capped, large type lists fail explicitly rather than returning an unlabelled partial list', async () => {
  disk('app/src/main/java/a/b/package-info.java', `/** ${'x'.repeat(8192)} */ package a.b;`);
  const source = 'app/src/main/java/a/b/Foo.java';
  disk(source, `package a.b; /** ${'b'.repeat(500)} */ public class Foo {}`);
  const out = output(mod('app'));
  const hit = await lookupPackageDocs(out, opts);
  if (!hit.ok) throw Error(hit.error.message);
  expect(hit.owners[0]!.description).toHaveLength(4096);
  expect(hit.owners[0]!.types[0]!.summary).toHaveLength(240);
  disk(source, 'package a.b;\n' + Array.from({ length: 257 }, (_, i) => `class C${i} {}`).join('\n'));
  expect(await lookupPackageDocs(out, opts)).toMatchObject({ error: { code: 'DOCS_RESOLVE_FAILED', message: expect.stringContaining('256') } });
});
