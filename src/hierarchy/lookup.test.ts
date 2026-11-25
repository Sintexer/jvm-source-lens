import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { zipSync } from 'fflate';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { computeBuildInputsDigest, writeCachedResolution } from '../cache/index.js';
import { getProjectResolutionCacheDir } from '../cache/paths.js';
import { getHierarchy, lookupHierarchy } from './lookup.js';

// Minimal class files with only the constants and inheritance edges used by the index.
function binary(name: string, superclass = 'java/lang/Object', interfaces: string[] = [], iface = false) {
  const names = [name, superclass, ...interfaces];
  const bytes = [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52, 0, names.length * 2 + 1];
  for (const [i, s] of names.entries()) bytes.push(1, 0, s.length, ...Buffer.from(s), 7, 0, i * 2 + 1);
  bytes.push(iface ? 6 : 0, iface ? 1 : 33, 0, 2, 0, 4, 0, interfaces.length);
  for (const i of interfaces.keys()) bytes.push(0, 6 + 2 * i);
  return Uint8Array.from([...bytes, 0, 0, 0, 0, 0, 0]);
}

let tmp: string, root: string, output: ResolutionOutput;
const oldCache = process.env.JVMSRC_CACHE_ROOT;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hierarchy-'));
  root = join(tmp, 'app');
  mkdirSync(root);
  process.env.JVMSRC_CACHE_ROOT = join(tmp, 'cache');
  output = { projectRoot: root, resolvedAt: '', schemaVersion: '1.1', errors: [],
    buildSystem: { type: 'gradle', version: '', wrapper: false }, modules: [{ name: ':app', path: root,
      configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts: [] }] }] };
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (oldCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
  else process.env.JVMSRC_CACHE_ROOT = oldCache;
});

function jar(id: string, entries: Record<string, Uint8Array>): ResolvedArtifact {
  const jarPath = join(tmp, id + '.jar');
  writeFileSync(jarPath, zipSync(Object.fromEntries(Object.entries(entries).map(([n, b]) => [n + '.class', b])), { level: 0 }));
  return { group: 'g', name: id, version: '1', origin: 'external', type: 'jar', direct: true, jarPath };
}
const query = { typeName: 'p.I' };
function search(opts: Parameters<typeof lookupHierarchy>[1] = query) {
  const result = lookupHierarchy(output, opts);
  if (!result.ok) throw Error(result.error.message);
  return result;
}

test('walks subinterfaces and inherited implementations; only the first class definition contributes edges', () => {
  const artifacts = output.modules[0]!.configurations[0]!.artifacts;
  artifacts.push(jar('api', { 'p/I': binary('p/I', undefined, [], true), 'p/J': binary('p/J', undefined, ['p/I'], true),
    'p/A': binary('p/A', undefined, ['p/I']), 'p/B': binary('p/B', undefined, ['p/J']) }),
  jar('impl', { 'p/A': binary('p/A'), 'p/C': binary('p/C', 'p/A') }));
  expect(search().groups.map(g => [g.coordinates.name, g.classes])).toEqual([
    ['api', [{ className: 'p.A', direct: true }, { className: 'p.B', direct: false }]],
    ['impl', [{ className: 'p.C', direct: false }]],
  ]);
  expect(search({ ...query, directOnly: true }).groups[0]!.classes).toEqual([{ className: 'p.A', direct: true }]);
  expect(search({ typeName: 'p.A' }).groups[0]!.classes).toEqual([{ className: 'p.C', direct: true }]);
  artifacts.reverse();
  expect(search().groups.flatMap(g => g.classes)).toEqual([{ className: 'p.B', direct: false }]);
});

test('infers reference-only kinds independently on each module classpath', () => {
  output.modules[0]!.configurations[0]!.artifacts.push(jar('one', { 'p/A': binary('p/A', undefined, ['p/I']) }));
  output.modules.push({ name: ':two', path: join(tmp, 'two'), configurations: [{ name: 'compileClasspath', scope: 'compile',
    artifacts: [jar('two', { 'p/C': binary('p/C', 'p/I') })] }] });
  expect(lookupHierarchy(output, query)).toMatchObject({ ok: false, error: { code: 'MODULE_AMBIGUOUS', modulePaths: [':app', ':two'] } });
  expect(search({ ...query, modulePath: ':app' })).toMatchObject({ kind: 'implementors', groups: [{ classes: [{ className: 'p.A' }] }] });
  expect(search({ ...query, modulePath: ':two' })).toMatchObject({ kind: 'subclasses', groups: [{ classes: [{ className: 'p.C' }] }] });
});

test('rejects contradictory references unless the target has a visible definition', () => {
  const artifacts = output.modules[0]!.configurations[0]!.artifacts;
  artifacts.push(jar('refs', { 'p/A': binary('p/A', 'p/I'), 'p/B': binary('p/B', undefined, ['p/I']) }));
  expect(lookupHierarchy(output, query)).toMatchObject({ ok: false, error: {
    code: 'HIERARCHY_TARGET_AMBIGUOUS', message: expect.stringContaining('modulePath'),
  } });
  artifacts.push(jar('iface', { 'p/I': binary('p/I', undefined, [], true) }), jar('cls', { 'p/I': binary('p/I') }));
  expect(search()).toMatchObject({ kind: 'implementors', totalMatches: 1, groups: [{ classes: [{ className: 'p.B' }] }] });
  artifacts.reverse();
  expect(search()).toMatchObject({ kind: 'subclasses', totalMatches: 1, groups: [{ classes: [{ className: 'p.A' }] }] });
});

test('subinterface-only evidence identifies an interface but does not return the subinterface', () => {
  output.modules[0]!.configurations[0]!.artifacts.push(jar('sub', { 'p/J': binary('p/J', undefined, ['p/I'], true) }));
  expect(search()).toMatchObject({ kind: 'implementors', groups: [], limitations: expect.arrayContaining([expect.stringMatching(/subinterfaces/i)]) });
  expect(search({ typeName: 'p.J' })).toMatchObject({ kind: 'implementors', totalMatches: 0 });
  expect(lookupHierarchy(output, { typeName: 'p.Unknown' })).toMatchObject({ ok: false, error: { code: 'CLASS_NOT_FOUND' } });
});

test('reads scoped compiled outputs, not source or dependency test classes; reflects output deletion', () => {
  const lib = join(tmp, 'lib');
  for (const [base, name] of [[root, 'java/test/p/Test'], [lib, 'kotlin/main/p/Lib'], [lib, 'java/test/p/Hidden']]) {
    const path = join(base!, 'build/classes', name! + '.class');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, binary(name!.slice(name!.indexOf('p/')), undefined, ['p/I']));
  }
  const main = output.modules[0]!.configurations[0]!;
  main.artifacts.push({ origin: 'interproject', type: 'project', direct: true, group: '', name: 'lib', version: null,
    jarPath: null, interproject: { moduleName: ':lib', modulePath: lib } }, jar('api', { 'p/I': binary('p/I', undefined, [], true) }));
  output.modules[0]!.configurations.push({ ...main, name: 'testCompileClasspath', scope: 'test-compile' });
  expect(search().groups.map(g => g.moduleName)).toEqual([':lib']);
  const tests = search({ ...query, configuration: 'testCompileClasspath' });
  expect(tests.groups.flatMap(g => g.classes.map(c => c.className)).sort()).toEqual(['p.Lib', 'p.Test']);
  rmSync(join(lib, 'build'), { recursive: true });
  expect(search().groups).toEqual([]);
  expect(search().limitations.join(' ')).toMatch(/source-only/i);
});

test('invalidates a replaced JAR even with the same length and mtime', () => {
  const first = jar('same', { 'p/A': binary('p/A', undefined, ['p/I']) });
  output.modules[0]!.configurations[0]!.artifacts.push(first);
  utimesSync(first.jarPath!, 1000, 1000);
  expect(search().groups[0]!.classes[0]!.className).toBe('p.A');
  jar('same', { 'p/B': binary('p/B', undefined, ['p/I']) });
  utimesSync(first.jarPath!, 1000, 1000);
  expect(search().groups[0]!.classes[0]!.className).toBe('p.B');
});

test('a misplaced workspace class cannot shadow a JAR; moving it invalidates the directory index', () => {
  const classes = join(root, 'build/classes/java/main');
  mkdirSync(join(classes, 'p'), { recursive: true });
  const misplaced = join(classes, 'p.Outer$Inner.class');
  const loadable = join(classes, 'p', 'Outer$Inner.class');
  writeFileSync(misplaced, binary('p/Outer$Inner'));
  output.modules[0]!.configurations[0]!.artifacts.push(jar('dep', {
    'p/I': binary('p/I', undefined, [], true), 'p/Outer$Inner': binary('p/Outer$Inner', undefined, ['p/I']),
  }));
  for (let i = 0; i < 2; i++) {
    expect(search().groups).toMatchObject([{ origin: 'external', classes: [{ className: 'p.Outer$Inner', direct: true }] }]);
  }
  renameSync(misplaced, loadable);
  expect(search().groups).toEqual([]);
  renameSync(loadable, misplaced);
  expect(search().totalMatches).toBe(1);
});

test('caps results after deterministic ordering and reports how many matched', () => {
  const entries: Record<string, Uint8Array> = {};
  for (let i = 210; i >= 0; i--) entries[`p/C${i}`] = binary(`p/C${i}`, 'p/Base');
  output.modules[0]!.configurations[0]!.artifacts.push(jar('many', entries));
  const result = search({ typeName: 'p.Base' });
  expect(result).toMatchObject({ truncated: true, totalMatches: 211 });
  const names = result.groups[0]!.classes.map(c => c.className);
  expect(names).toEqual(Object.keys(entries).map(n => n.replace('/', '.')).sort().slice(0, result.limit));
});

test('an oversized but parseable cache sidecar is ignored and rebuilt', () => {
  output.modules[0]!.configurations[0]!.artifacts.push(jar('one', { 'p/A': binary('p/A', undefined, ['p/I']) }));
  expect(search().totalMatches).toBe(1);
  const bucket = getProjectResolutionCacheDir(root);
  if (!bucket.ok) throw Error(bucket.message);
  const dir = join(bucket.dir, 'hierarchy-v1');
  const file = join(dir, readdirSync(dir)[0]!);
  const size = statSync(file).size;
  // Keep the original valid JSON, padded with whitespace beyond the cache read budget.
  writeFileSync(file, Buffer.alloc(17 * 1024 * 1024, 32), { flag: 'a' });
  expect(search().totalMatches).toBe(1);
  expect(statSync(file).size).toBe(size);
});

test('public lookup uses cached resolution, normalizes class paths, and writes nothing to the project', async () => {
  writeFileSync(join(root, 'settings.gradle'), '');
  output.modules[0]!.configurations[0]!.artifacts.push(jar('lib', { 'p/Impl': binary('p/Impl', undefined, ['p/I']) }));
  expect(writeCachedResolution(root, output, computeBuildInputsDigest(root)).ok).toBe(true);
  expect(await getHierarchy({ projectRoot: root, typeName: 'p/I.class' })).toMatchObject({
    ok: true, className: 'p.I', kind: 'implementors', groups: [{ classes: [{ className: 'p.Impl', direct: true }] }],
  });
  expect(await getHierarchy({ ...query, projectRoot: root, modulePath: ':missing' })).toMatchObject({ ok: false, error: { code: 'MODULE_NOT_FOUND' } });
  expect(readdirSync(root)).toEqual(['settings.gradle']);
});

test('Maven test scope follows superclass edges across workspace and local JARs, reusing binary indexes', () => {
  output.buildSystem.type = 'maven';
  const classes = join(root, 'target/test-classes/p');
  mkdirSync(classes, { recursive: true });
  writeFileSync(join(classes, 'Leaf.class'), binary('p/Leaf', 'p/Mid'));
  const dep = jar('local', { 'p/Mid': binary('p/Mid', 'p/Base') });
  output.modules[0]!.configurations.push({ name: 'test', scope: 'test-compile', artifacts: [{ ...dep, origin: 'local-file', type: 'local-file' }] });
  const opts = { typeName: 'p.Base', includeTest: true };
  expect(search(opts).groups).toMatchObject([
    { origin: 'workspace', classes: [{ className: 'p.Leaf', direct: false }] },
    { origin: 'local-file', jarPath: dep.jarPath, classes: [{ className: 'p.Mid', direct: true }] },
  ]);
  const bucket = getProjectResolutionCacheDir(root);
  if (!bucket.ok) throw Error(bucket.message);
  const dir = join(bucket.dir, 'hierarchy-v1');
  const inodes = () => readdirSync(dir).sort().map(file => statSync(join(dir, file), { bigint: true }).ino);
  const before = inodes();
  expect(before.length).toBe(2);
  expect(search({ ...opts, directOnly: true }).groups).toMatchObject([{ origin: 'local-file', classes: [{ className: 'p.Mid', direct: true }] }]);
  expect(inodes()).toEqual(before);
});
