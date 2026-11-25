import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readClassJavadoc } from './class-javadoc.js';

let dir: string, jar: string, oldRoot: string | undefined;
const path = 'p/Outer.Inner.html';
const read = () => readClassJavadoc(jar, 'p.Outer$Inner');
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'class-javadoc-'));
  jar = join(dir, 'docs.jar');
  oldRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = join(dir, 'cache');
});
afterEach(() => {
  if (oldRoot === undefined) delete process.env.JVMSRC_CACHE_ROOT;
  else process.env.JVMSRC_CACHE_ROOT = oldRoot;
  rmSync(dir, { recursive: true, force: true });
});
function archive(entries: Record<string, string>) {
  writeFileSync(jar, zipSync(Object.fromEntries(Object.entries(entries).map(([k,v]) => [k,strToU8(v)]))));
}

for (const version of [8, 11, 17, 25]) test(`JDK ${version}: exact declared docs without source or bytecode`, async () => {
  const modern = version >= 17;
  const attr = version === 8 ? 'name' : 'id';
  const block = (s: string) => `<div class="block">${s}</div>`;
  const list = (s: string) => `<ul class="blockList"><li class="blockList">${s}</li></ul>`;
  const member = (id: string, s: string) => modern ? `<section class="detail" id="${id}">${version === 25 ? `<div class="horizontal-scroll">${block(s)}</div>` : block(s)}</section>` :
    `<a ${attr}="${id}"></a>${list('<h4>Member</h4><pre>signature</pre>' + block(s))}`;
  const group = (kind: string, s: string) => modern ? `<section class="${kind}-details"><ul><li>${s}</li></ul></section>` :
    list(`<a ${attr}="${kind}.detail"></a><h3>Detail</h3>${s}`);
  const anchor = (legacy: string, newer: string) => version === 8 ? legacy : newer;
  const html = (modern ? `<section class="class-description">${block('Full &amp; <code>plain</code>.')}</section>` :
    `<div class="description">${list(block('Full &amp; <code>plain</code>.'))}</div>`) +
    `<div class="summary"><a href="Parent.html#base()">base</a>${block('Inherited.')}</div>` +
    '<div class="details">' + group('field', member('VALUE', 'Field.')) +
    group('constructor', member(anchor('Inner--', version === 11 ? '&lt;init&gt;()' : '%3Cinit%3E()'), 'Construct.')) +
    group('method', member(anchor('put-java.sql.Date-', 'put(java.sql.Date)'), 'SQL.') +
      member(anchor('put-java.util.Date-', 'put(java.util.Date)'), 'Util.') +
      member(anchor('mix-int:A:A-p.Outer.Inner...-', 'mix(int%5B%5D%5B%5D,p.Outer.Inner...)'), 'Arrays.') +
      member(anchor('put-T-', 'put(T)'), 'Generic.') + member(anchor('dup--', 'dup()'), 'One.') +
      member(anchor('dup--', 'dup()'), 'Two.')) + '</div>';
  archive({ [version === 8 ? path : 'my.module/' + path]: html });
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = (await read())!;
    expect(doc.description).toBe('Full & plain.');
    expect(doc.fieldDoc('VALUE')).toBe('Field.');
    expect(doc.fieldDoc('toString')).toBeNull();
    expect(doc.methodDoc('<init>', '()V')).toBe('Construct.');
    expect(doc.methodDoc('Inner', '()V')).toBeNull();
    expect(doc.methodDoc('put', '(Ljava/sql/Date;)V')).toBe('SQL.');
    expect(doc.methodDoc('put', '(Ljava/util/Date;)Z')).toBe('Util.');
    expect(doc.methodDoc('mix', '([[I[Lp/Outer$Inner;)V')).toBe('Arrays.');
    for (const d of ['(Ljava/lang/Object;)V', '(Lother/Date;)V', '(Ljava/util/Date;)', '(Ljava.util.Date;)V']) {
      expect(doc.methodDoc('put', d)).toBeNull();
    }
    expect(doc.methodDoc('base', '()V')).toBeNull();
    expect(doc.methodDoc('dup', '()V')).toBeNull();
  }
});

test('reads a legacy member at the 2 MiB class page limit, but not one byte over', async () => {
  const entry = 'oracle/jdbc/OracleConnection.html';
  const member = `<a name="method.detail"></a><h3>Method Detail</h3>
    <a name="setDefaultRowPrefetch-int-"></a><ul class="blockList"><li class="blockList">
    <h4>setDefaultRowPrefetch</h4><pre>void&nbsp;setDefaultRowPrefetch(int&nbsp;value)</pre>
    <div class="block">Sets the default for statements created after this call.</div></li></ul>`;
  const limit = 2 * 1024 * 1024;
  const readOracle = () => readClassJavadoc(jar, 'oracle.jdbc.OracleConnection');
  archive({ [entry]: member.padStart(limit) });
  expect((await readOracle())?.methodDoc('setDefaultRowPrefetch', '(I)V')).toBe('Sets the default for statements created after this call.');
  archive({ [entry]: member.padStart(limit + 1) });
  expect(await readOracle()).toBeNull();
});

test('missing, malformed and ambiguous pages have no usable docs', async () => {
  expect(await read()).toBeNull();
  for (const entries of [{ 'p/Outer.html': 'outer' }, { [path]: '<section' },
    { [path]: '<div>not a Javadoc page</div>' }, { ['a/' + path]: '', ['b/' + path]: '' }]) {
    archive(entries as Record<string, string>);
    expect(await read()).toBeNull();
  }
  writeFileSync(jar, 'not a ZIP');
  expect(await read()).toBeNull();
});

test('does not borrow notes, copied docs, inherited entries, or generic erasures', async () => {
  archive({ [path]: `<section class="class-description"><dl class="notes"><dd><div class="block">Note.</div></dd></dl></section>
    <div class="inherited-list"><section class="detail" id="base()"><div class="block">Inherited.</div></section></div>
    <section class="method-details"><section class="detail" id="copied()"><div class="block"><span class="descfrm-type-label">Description copied from interface:</span></div><div class="block">Parent.</div></section>
    <section class="detail" id="f(T)"><h3 id="f(java.lang.Object)">f</h3><div class="block">Generic.</div></section>
    <section class="detail" id="f(int)"><div class="block">Primitive.</div></section></section>` });
  const doc = (await read())!;
  expect(doc.description).toBeNull();
  expect(doc.methodDoc('copied', '()V')).toBeNull();
  expect(doc.methodDoc('base', '()V')).toBeNull();
  expect(doc.methodDoc('f', '(Ljava/lang/Object;)V')).toBeNull();
  expect(doc.methodDoc('f', '(Lint;)V')).toBeNull();
  expect(doc.methodDoc('f', '(I)V')).toBe('Primitive.');
});

test('cache separates entries and same-size, same-mtime replacements', async () => {
  const html = (s: string) => `<section class="class-description"><div class="block">${s}</div></section>`;
  for (const s of ['one', 'two']) {
    archive({ [path]: html(s), 'p/Other.html': html('other') });
    utimesSync(jar, 1234, 1234);
    expect((await read())?.description).toBe(s);
    expect((await readClassJavadoc(jar, 'p.Other'))?.description).toBe('other');
    expect(await readClassJavadoc(jar, 'Other')).toBeNull();
  }
});
