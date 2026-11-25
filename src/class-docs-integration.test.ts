import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import * as javap from './class-structure/spawn-javap.js';
import * as ownership from './extractor/find-external-class-jar.js';
import { getClassStructure } from './get-class-structure.js';
import { getMethodSignatures } from './get-method-signatures.js';
import { getMethodSignaturesBytecode } from './get-method-signatures-bytecode.js';
import * as resolution from './resolve-with-cache.js';
import { resolverById } from './resolvers/index.js';
import type { ResolvedArtifact } from './resolvers/base.js';

const resolver = resolverById('gradle')!;
const coords = { group: 'example', name: 'binary', version: '42' };
const tag = { docsSource: 'javadoc-jar' };
let root: string;
let previousCache: string | undefined;
let artifact: ResolvedArtifact;
let artifacts: ResolvedArtifact[];
let docsJar: string;
const opts = () => ({ projectRoot: root, modulePath: join(root, 'consumer/src/Use.java') });
const member = (declaration: string, descriptor: string, flags = 'ACC_PUBLIC') =>
  `  public ${declaration};\n    descriptor: ${descriptor}\n    flags: (0x0001) ${flags}`;
const detail = (id: string, text: string) => `<section class="detail" id="${id}"><h3>${id.split('(')[0]}</h3><div class="block">${text}</div></section>`;
const page = `<section class="class-description" id="class-description"><div class="block">Class purpose.</div></section>
<section class="field-details" id="field-detail">${detail('value', 'Field docs.')}</section>
<section class="method-details" id="method-detail">${detail('pick(int)', 'Integer docs.')}${detail('pick(long)', 'Long docs.')}</section>`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'class-docs-'));
  previousCache = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = join(root, 'cache');
  const jar = join(root, 'binary.jar');
  docsJar = join(root, 'docs.jar');
  writeFileSync(jar, zipSync({ 'p/Api.class': new Uint8Array(), 'p/Base.class': new Uint8Array() }));
  writeFileSync(docsJar, zipSync({ 'p/Api.html': strToU8(page) }));
  artifact = { ...coords, type: 'jar', origin: 'external', jarPath: jar, direct: true };
  artifacts = [artifact];
  spyOn(resolution, 'resolveWithResolutionCache').mockResolvedValue({ ok: true, output: {
    projectRoot: root, schemaVersion: '1.2', resolvedAt: '', errors: [], buildSystem: { type: 'gradle', version: '', wrapper: false },
    modules: [{ name: ':consumer', path: join(root, 'consumer'), configurations: [
      { name: 'compileClasspath', scope: 'compile', artifacts },
    ] }],
  } });
  spyOn(resolver, 'resolveSourcesJar').mockResolvedValue({ ok: true, sourcesJarPath: null });
  spyOn(resolver, 'resolveJavadocJar').mockResolvedValue({ ok: true, javadocJarPath: docsJar });
  spyOn(javap, 'spawnJavapVerbose').mockImplementation(async ({ className }) => {
    const api = className === 'p.Api';
    const rows = api ? [member('int value', 'I'), member('void pick(int)', '(I)V'), member('void pick(long)', '(J)V'),
      member('void pick(double)', '(D)V'), member('Object pick(int)', '(I)Ljava/lang/Object;', 'ACC_BRIDGE, ACC_SYNTHETIC'),
      member('int other()', '()I')]
      : [member('void base()', '()V')];
    return { ok: true, stdout: `public class ${className}${api ? ' extends p.Base' : ''}\nConstant pool:\n{\n${rows.join('\n\n')}\n}\nSourceFile: "Api.java"` };
  });
});

afterEach(() => {
  mock.restore();
  if (previousCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
  else process.env.JVMSRC_CACHE_ROOT = previousCache;
  rmSync(root, { recursive: true, force: true });
});

test('class page enriches only the primary type and matching declared rows', async () => {
  const result = await getClassStructure('p.Api', opts());
  expect(result).toMatchObject({ ok: true, sourceAvailable: false, classPurpose: 'Class purpose.', ...tag,
    provenance: { kind: 'classpathJar', coordinates: coords }, fields: [{ name: 'value', javadoc: 'Field docs.', ...tag }],
    methods: [{ jvmDescriptor: '(I)V', javadoc: 'Integer docs.', ...tag }, { jvmDescriptor: '(J)V', javadoc: 'Long docs.', ...tag },
      { jvmDescriptor: '(D)V', javadoc: null }, { name: 'other', javadoc: null }, { name: 'base', inherited: true, javadoc: null }] });
  expect(resolver.resolveJavadocJar).toHaveBeenCalledTimes(1);
  expect(resolver.resolveJavadocJar).toHaveBeenCalledWith(root, coords, ':consumer');
});

test('parallel signature requests share one classifier/page, never assign by arity', async () => {
  const options = { ...opts(), javadocCache: new Map() };
  const [result, other] = await Promise.all([getMethodSignatures('p.Api', 'pick', options), getMethodSignatures('p.Api', 'other', options)]);
  expect(other).toMatchObject({ ok: true, methodFound: true });
  expect(result).toMatchObject({ ok: true, sourceAvailable: false, methodFound: true, overloads: [
    { jvmDescriptor: '(I)V', javadoc: 'Integer docs.', ...tag }, { jvmDescriptor: '(J)V', javadoc: 'Long docs.', ...tag },
    { jvmDescriptor: '(D)V' }] });
  if (result.ok) expect(result.overloads[2]).not.toHaveProperty('docsSource');
  expect(resolver.resolveJavadocJar).toHaveBeenCalledTimes(1);
});

test('lookup and page failures leave the successful bytecode result unchanged', async () => {
  const base = await getMethodSignaturesBytecode('p.Api', 'pick', opts());
  expect(base.ok).toBe(true);
  expect(resolver.resolveJavadocJar).not.toHaveBeenCalled();
  spyOn(resolver, 'resolveJavadocJar').mockRejectedValueOnce(Error('transfer failed'));
  expect(await getMethodSignatures('p.Api', 'pick', opts())).toEqual(base);
  writeFileSync(docsJar, 'not a zip');
  expect(await getMethodSignatures('p.Api', 'pick', opts())).toEqual(base);
  expect(resolver.resolveJavadocJar).toHaveBeenCalledTimes(2);
});

test('local jars and source hits that cannot be parsed do not request Javadoc', async () => {
  artifact.origin = 'local-file';
  artifact.type = 'local-file';
  expect(await getClassStructure('p.Api', opts())).toMatchObject({ ok: true, sourceAvailable: false });
  artifact.origin = 'external';
  artifact.type = 'jar';
  artifact.sourcesJarPath = join(root, 'sources.jar');
  writeFileSync(artifact.sourcesJarPath, zipSync({ 'p/Api.java': strToU8('// no declaration') }));
  expect(await getMethodSignatures('p.Api', 'pick', opts())).toMatchObject({ ok: true, sourceAvailable: false });
  expect(resolver.resolveJavadocJar).not.toHaveBeenCalled();
});

test('source transfer failure preserves bytecode without requesting another classifier', async () => {
  spyOn(resolver, 'resolveSourcesJar').mockResolvedValue({ ok: false, message: 'Offline' });
  expect(await getMethodSignatures('p.Api', 'pick', opts())).toMatchObject({ ok: true, sourceAvailable: false });
  expect(await getClassStructure('p.Api', opts())).toMatchObject({ ok: true, sourceAvailable: false, classPurpose: null });
  expect(resolver.resolveJavadocJar).not.toHaveBeenCalled();
});

test('a member-only page never labels class purpose', async () => {
  writeFileSync(docsJar, zipSync({ 'p/Api.html': strToU8(page.slice(page.indexOf('\n'))) }));
  const result = await getClassStructure('p.Api', opts());
  expect(result).toMatchObject({ ok: true, classPurpose: null, fields: [{ name: 'value', ...tag }] });
  expect(result).not.toHaveProperty('docsSource');
});

test('workspace bytecode shadowing an external class does not fetch either classifier', async () => {
  const classes = join(root, 'consumer/build/classes/java/main/p');
  mkdirSync(classes, { recursive: true });
  writeFileSync(join(classes, 'Api.class'), '');
  for (const result of [await getMethodSignatures('p.Api', 'pick', opts()), await getClassStructure('p.Api', opts())]) {
    expect(result).toMatchObject({ ok: true, sourceAvailable: false, provenance: { kind: 'interprojectBytecode' } });
  }
  expect(resolver.resolveSourcesJar).not.toHaveBeenCalled();
  expect(resolver.resolveJavadocJar).not.toHaveBeenCalled();
});

test('source-first signatures accept an earlier cached source without a second binary scan', async () => {
  const sources = join(root, 'original-sources.jar');
  writeFileSync(sources, zipSync({ 'p/Api.java': strToU8('package p; public class Api { public int fromSource() { return 1; } }') }));
  const otherJar = join(root, 'other.jar');
  writeFileSync(otherJar, zipSync({ 'p/Other.class': new Uint8Array() }));
  artifacts.unshift({ ...artifact, name: 'other', jarPath: otherJar, sourcesJarPath: sources });
  const owner = spyOn(ownership, 'findClasspathOwningClass');
  expect(await getMethodSignatures('p.Api', 'fromSource', opts())).toMatchObject({ ok: true, sourceAvailable: true,
    methodFound: true, provenance: { kind: 'sourcesJar', jarPath: sources } });
  expect(owner).toHaveBeenCalledTimes(1); // Existing scope/canonical name probe only.
  expect(javap.spawnJavapVerbose).not.toHaveBeenCalled();
  expect(resolver.resolveJavadocJar).not.toHaveBeenCalled();
});

test('hierarchy falls back to on-demand Java sources, never an inherited Javadoc page', async () => {
  const dir = join(root, 'consumer/src/main/java/p');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Api.java'), 'package p; public class Api extends Base {}');
  const sources = join(root, 'base-sources.jar');
  writeFileSync(sources, zipSync({ 'p/Base.java': strToU8('package p; public class Base { public void fromBase() {} }') }));
  spyOn(resolver, 'resolveSourcesJar').mockResolvedValue({ ok: true, sourcesJarPath: sources });
  spyOn(javap, 'spawnJavapVerbose').mockResolvedValue({ ok: false, message: 'unavailable' });
  const result = await getClassStructure('p.Api', opts());
  expect(result).toMatchObject({ ok: true, sourceAvailable: true, methods: expect.arrayContaining([
    expect.objectContaining({ name: 'fromBase', declaringClass: 'p.Base', inherited: true }),
  ]) });
  expect(resolver.resolveSourcesJar).toHaveBeenCalledTimes(1);
  expect(resolver.resolveJavadocJar).not.toHaveBeenCalled();
});
