import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readPackageJavadoc } from './package-javadoc.js';

const page = 'org/example/package-summary.html';
let dir: string, jar: string, cache: string, oldRoot: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'package-javadoc-'));
  jar = join(dir, 'docs.jar');
  cache = join(dir, 'cache');
  oldRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = cache;
});
afterEach(() => {
  if (oldRoot === undefined) delete process.env.JVMSRC_CACHE_ROOT;
  else process.env.JVMSRC_CACHE_ROOT = oldRoot;
  rmSync(dir, { recursive: true, force: true });
});
function archive(entries: Record<string, string>) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([k,v]) => [k,strToU8(v)]))));
}
const read = () => readPackageJavadoc(jar, 'org.example');

for (const version of [8, 11]) test(`JDK ${version}: full description and table rows`, async () => {
  const entryPath = version === 8 ? page : 'my.module/' + page;
  writeFileSync(jar, archive({ [entryPath]: `<div class="header"><div class="block">Teaser.</div></div>
    <table class="typeSummary"><tr><${version === 8 ? 'td' : 'th'} class="colFirst"><a href="${version === 8 ? '../../org/example/' : ''}Foo.html">Foo</a></${version === 8 ? 'td' : 'th'}>
    <td class="colLast"><div class="block">A <code>type</code>.</div></td></tr></table>
    <a ${version === 8 ? 'name' : 'id'}="package.description"></a><h2>Description</h2>
    <div class="block">Full &amp; complete.<p>More.</p></div>` }));
  expect(await read()).toEqual({ entryPath, description: 'Full & complete. More.', summaries: { Foo: 'A type.' } });
});

test('modern grid: text only, local type links only, no inherited object keys', async () => {
  writeFileSync(jar, archive({ [page]: `<section class="package-description" id="package-description"><div class="block">API<script src="https://invalid/">bad</script><STYLE>bad</STYLE> docs.</div></section>
    <div class="summary-table two-column-summary"><div class="col-first"><a href="__proto__.html">__proto__</a></div><div class="col-last"><div class="block">Safe.</div></div>
    <div class="col-first"><a href="https://invalid/Bad.html">Bad</a></div><div class="col-last">Wrong.</div></div>` }));
  const doc = await read();
  expect(doc?.description).toBe('API docs.');
  expect(Object.entries(doc!.summaries)).toEqual([['__proto__', 'Safe.']]);
});

test('only package pages count; misses and ambiguous pages do not populate cache', async () => {
  writeFileSync(jar, archive({ 'org/example/Foo.html': '', ['deep/tree/' + page]: '' }));
  expect(await read()).toBeNull();
  writeFileSync(jar, archive({ ['one/' + page]: '', ['two/' + page]: '' }));
  await expect(read()).rejects.toThrow(/ambiguous/i);
  expect(existsSync(cache)).toBe(false);
});

test('a package without a description does not borrow prose from its types', async () => {
  writeFileSync(jar, archive({ [page]: `<table class="typeSummary"><tr><td class="colFirst"><a href="Foo.html">Foo</a></td><td class="colLast">Type only.</td></tr></table>` }));
  expect(await read()).toEqual({ entryPath: page, description: null, summaries: { Foo: 'Type only.' } });
});

test('excessive HTML nesting and corrupt stored data fail without caching', async () => {
  writeFileSync(jar, archive({ [page]: '<div>'.repeat(1000) }));
  await expect(read()).rejects.toThrow(/depth/i);
  const stored = Buffer.from(zipSync({ [page]: strToU8('stored content') }, { level: 0 }));
  stored[stored.indexOf('stored content')] = 0;
  writeFileSync(jar, stored);
  await expect(read()).rejects.toThrow();
  expect(existsSync(cache)).toBe(false);
});

test('cache separates entries and detects same-size same-mtime archive replacement', async () => {
  const other = 'org/other/package-summary.html';
  const html = (s: string) => `<section id="package-description"><div class="block">${s}</div></section>`;
  for (const value of ['one', 'two']) {
    writeFileSync(jar, archive({ [page]: html(value), [other]: html('other') }));
    utimesSync(jar, 12345, 12345);
    expect((await read())?.description).toBe(value);
    expect((await readPackageJavadoc(jar, 'org.other'))?.description).toBe('other');
    expect((await read())?.description).toBe(value);
  }
  expect(readdirSync(cache, { recursive: true }).filter(f => f.toString().endsWith('.json'))).toHaveLength(4);
});

test('invalid ZIP and falsely small deflated page fail without caching', async () => {
  writeFileSync(jar, 'not a zip');
  await expect(read()).rejects.toThrow();
  const raw = archive({ [page]: 'x'.repeat(2 * 1024 * 1024) });
  const central = raw.readUInt32LE(raw.length - 6);
  raw.writeUInt32LE(1, 22);
  raw.writeUInt32LE(1, central + 24);
  writeFileSync(jar, raw);
  await expect(read()).rejects.toThrow();
  expect(existsSync(cache)).toBe(false);
});

test('caps prose and rejects archives over the configured limit even on cache hit', async () => {
  writeFileSync(jar, archive({ [page]: `<section id="package-description"><div class="block">${'a'.repeat(10000)}</div></section>` }));
  expect((await read())!.description!.length).toBeLessThanOrEqual(4096);
  const old = process.env.JVMSRC_MAX_JAR_BYTES;
  try {
    process.env.JVMSRC_MAX_JAR_BYTES = '20';
    await expect(read()).rejects.toThrow();
  } finally {
    if (old === undefined) delete process.env.JVMSRC_MAX_JAR_BYTES;
    else process.env.JVMSRC_MAX_JAR_BYTES = old;
  }
});
