import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { readHierarchyHeader, scanHierarchyJar } from './scan.js';

const dirs: string[] = [];
function jar(bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), 'hierarchy-'));
  dirs.push(dir);
  const path = join(dir, 'fixture.jar');
  writeFileSync(path, bytes);
  return path;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

// JVMS 4.1: this_class, super_class and interfaces refer to Class -> Utf8 pairs.
// The array Class constant is legal in the pool, but not as a hierarchy edge.
function header(names: Buffer[], flags = 0x21) {
  const u2 = (n: number) => Buffer.from([n >> 8, n & 255]);
  const strings = [...names, Buffer.from('[I')];
  return Buffer.concat([
    Buffer.from('cafebabe00000034', 'hex'), u2(1 + 2 * strings.length),
    ...strings.flatMap((s, i) => [Buffer.of(1), u2(s.length), s, Buffer.of(7), u2(2 * i + 1)]),
    u2(flags), u2(2), u2(names.length > 1 ? 4 : 0), u2(Math.max(0, names.length - 2)),
    ...names.slice(2).map((_, i) => u2(6 + 2 * i)),
    Buffer.alloc(6), // fields, methods, attributes
  ]);
}
const object = Buffer.from('java/lang/Object');
const nested = header([Buffer.from('p/A$B'), object, Buffer.from('p/I')]);

test('reads only the header; preserves binary names and direct interface order', () => {
  // Supplementary U+10400 encoded as two surrogate code units in modified UTF-8.
  const name = Buffer.concat([Buffer.from('p/'), Buffer.from('eda081edb080', 'hex')]);
  const bytes = header([name, object, Buffer.from('p/I'), Buffer.from('p/J')], 0x601);
  expect(readHierarchyHeader(bytes.subarray(0, -6))).toEqual({
    name: 'p.\u{10400}', superclass: null, interfaces: ['p.I', 'p.J'], isInterface: true,
  });
  expect(readHierarchyHeader(header([object])).superclass).toBeNull();
});

test('rejects malformed class headers and references', () => {
  for (const bytes of [Buffer.alloc(20), nested.subarray(0, -9), header([Buffer.from('[I'), object]),
    header([Buffer.from([0xff]), object])]) {
    expect(() => readHierarchyHeader(bytes)).toThrow(/class/i);
  }
  const wrongTag = Buffer.from(nested);
  wrongTag.writeUInt16BE(1, wrongTag.length - 14); // this_class points to Utf8, not Class
  expect(() => readHierarchyHeader(wrongTag)).toThrow(/class/i);
});

test('reads real compiled classes from the bundled CFR archive', () => {
  const nodes = scanHierarchyJar(join(import.meta.dir, '../../resources/cfr.jar'));
  expect(nodes.find(n => n.name === 'org.benf.cfr.reader.api.CfrDriver')).toMatchObject({ isInterface: true });
  expect(nodes.find(n => n.name === 'org.benf.cfr.reader.api.CfrDriver$Builder')).toMatchObject({ superclass: 'java.lang.Object' });
});

test('scans stored and deflated base classes, never inflates resources or versioned entries', () => {
  const zip = Buffer.from(zipSync({
    'asset': Buffer.alloc(2000), 'p/A$B.class': nested,
    'p/I.class': [header([Buffer.from('p/I'), object], 0x601), { level: 0 }],
    'META-INF/versions/17/p/I.class': Buffer.of(1), 'module-info.class': Buffer.of(1),
  }));
  zip[30 + 'asset'.length] = 0xff; // invalid DEFLATE; must not touch this payload
  expect(scanHierarchyJar(jar(zip))).toEqual([
    { name: 'p.A$B', superclass: 'java.lang.Object', interfaces: ['p.I'], isInterface: false },
    { name: 'p.I', superclass: null, interfaces: [], isInterface: true },
  ]);
});

test('only emits classes loadable by their exact binary name at the JAR root', () => {
  const relocated = header([Buffer.from('p/A$B'), Buffer.from('p/WrongParent')]);
  const aliases = {
    'BOOT-INF/classes/p/A$B.class': relocated, 'p/Other.class': relocated,
    'p\\A$B.class': relocated, '/p/A$B.class': relocated,
  };
  expect(scanHierarchyJar(jar(zipSync(aliases)))).toEqual([]);
  expect(scanHierarchyJar(jar(zipSync({ 'p/A$B.class': nested, ...aliases })))).toEqual([readHierarchyHeader(nested)]);
});

test('skips root and packaged descriptors but not similarly named classes', () => {
  const ordinary = header([Buffer.from('p/mypackage-info'), object]);
  const entries = {
    'package-info.class': header([Buffer.from('package-info'), object]),
    'p/package-info.class': header([Buffer.from('p/package-info'), object]),
    'module-info.class': Buffer.of(1), 'p/module-info.class': Buffer.of(1),
    'p/mypackage-info.class': ordinary,
  };
  expect(scanHierarchyJar(jar(zipSync(entries)))).toEqual([readHierarchyHeader(ordinary)]);
});

test('duplicate entry paths use the last central-directory definition', () => {
  const replacement = header([Buffer.from('p/A$B'), Buffer.from('p/Base')]);
  for (const last of [replacement, header([Buffer.from('p/Other'), object])]) {
    const zip = Buffer.from(zipSync({ 'p/A$B.class': nested, 'p/A$X.class': last }));
    // zipSync accepts distinct keys; rename the second entry in both ZIP headers.
    const alias = 'p/A$X.class';
    for (let at = zip.indexOf(alias); at !== -1; at = zip.indexOf(alias, at + alias.length)) zip.write('p/A$B.class', at);
    expect(scanHierarchyJar(jar(zip))).toEqual(last === replacement ? [readHierarchyHeader(last)] : []);
  }
});

test('rejects malformed directories, inconsistent local headers and corrupt class payloads', () => {
  const zip = Buffer.from(zipSync({ 'p/A$B.class': [nested, { level: 0 }] }));
  const badLocal = Buffer.from(zip);
  badLocal[30] = 0;
  const badPayload = Buffer.from(zip);
  badPayload[30 + 'p/A$B.class'.length + nested.length - 1] = 1;
  for (const bytes of [zip.subarray(0, -1), Buffer.alloc(0), badLocal, badPayload]) {
    expect(() => scanHierarchyJar(jar(bytes))).toThrow(/ZIP|JAR|CRC/i);
  }
});

test('reads streamed DEFLATE entries with sizes in a data descriptor', () => {
  const zip = Buffer.from(zipSync({ 'p/A$B.class': nested }));
  const central = zip.readUInt32LE(zip.length - 6);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50);
  zip.copy(descriptor, 4, 14, 26);
  zip.fill(0, 14, 26);
  zip.writeUInt16LE(zip.readUInt16LE(6) | 8, 6);
  zip.writeUInt16LE(zip.readUInt16LE(central + 8) | 8, central + 8);
  zip.writeUInt32LE(central + descriptor.length, zip.length - 6);
  const streamed = Buffer.concat([zip.subarray(0, central), descriptor, zip.subarray(central)]);
  expect(scanHierarchyJar(jar(streamed))).toEqual([readHierarchyHeader(nested)]);
  streamed.writeUInt32LE(0, central + 4); // descriptor CRC disagrees with directory
  expect(() => scanHierarchyJar(jar(streamed))).toThrow(/descriptor/i);
});

test('bounds actual inflation even if the local and central size agree on a lie', () => {
  const zip = Buffer.from(zipSync({ 'p/A$B.class': Buffer.concat([nested, Buffer.alloc(1024 * 1024)]) }));
  const central = zip.readUInt32LE(zip.length - 6);
  zip.writeUInt32LE(nested.length, central + 24);
  zip.writeUInt32LE(nested.length, 22);
  expect(() => scanHierarchyJar(jar(zip))).toThrow(/size|limit/i);
});

test('enforces per-class and aggregate expanded byte budgets', () => {
  const mib = 1024 * 1024;
  const oversized = Buffer.concat([nested, Buffer.alloc(8 * mib)]);
  expect(() => readHierarchyHeader(oversized)).toThrow(/limit/i);
  expect(() => scanHierarchyJar(jar(zipSync({ 'p/A$B.class': oversized }, { level: 1 })))).toThrow(/class size limit/i);
  const padded = Buffer.alloc(4 * mib);
  const entries = Object.fromEntries(Array.from({ length: 17 }, (_, i) => {
    const bytes = Buffer.from(padded);
    bytes.set(header([Buffer.from(`p/C${i}`), object]));
    return [`p/C${i}.class`, bytes];
  }));
  expect(() => scanHierarchyJar(jar(zipSync(entries, { level: 1 })))).toThrow(/aggregate|total/i);
});

test('respects the configured archive size before parsing', () => {
  const saved = process.env.JVMSRC_MAX_JAR_BYTES;
  try {
    process.env.JVMSRC_MAX_JAR_BYTES = '16';
    expect(() => scanHierarchyJar(jar(Buffer.alloc(17)))).toThrow(/JVMSRC_MAX_JAR_BYTES/);
  } finally {
    if (saved === undefined) delete process.env.JVMSRC_MAX_JAR_BYTES;
    else process.env.JVMSRC_MAX_JAR_BYTES = saved;
  }
});
