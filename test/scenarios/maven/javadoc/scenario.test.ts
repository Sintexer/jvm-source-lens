import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { getPackageDocs } from '../../../../src/get-package-docs.js';
import { MavenResolver } from '../../../../src/resolvers/maven/index.js';
import { createTempLocalRepo, type TempLocalRepo } from '../_helpers.js';

const wrapper = path.resolve(import.meta.dir, '../multi-module');
const gav = { group: 'example', name: 'library', version: '1' };

describe.skipIf(!fs.existsSync(path.join(wrapper, '.mvn/wrapper/maven-wrapper.jar')))('Maven Javadoc classifier', () => {
  const resolver = new MavenResolver();
  const page = 'example/package-summary.html';
  const jar = zipSync({ [page]: strToU8(`<section id="package-description"><div class="block">Example package docs.</div></section>
    <table class="typeSummary"><tr><td class="colFirst"><a href="Widget.html">Widget</a></td>
    <td class="colLast"><div class="block">A documented widget.</div></td></tr></table>`) });
  let root: string;
  let local: TempLocalRepo;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    local = createTempLocalRepo('jvmsrc-javadoc');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-javadoc-'));
    fs.cpSync(path.join(wrapper, '.mvn'), path.join(root, '.mvn'), { recursive: true });
    for (const file of ['mvnw', 'mvnw.cmd']) fs.copyFileSync(path.join(wrapper, file), path.join(root, file));
    fs.writeFileSync(path.join(root, 'settings.xml'), '<settings/>');
    fs.writeFileSync(path.join(root, '.mvn/maven.config'), '--settings\nsettings.xml\n');
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null, { status: 403 }) });
    const pom = (group: string, name: string, body: string) => `<project><modelVersion>4.0.0</modelVersion>
      <groupId>${group}</groupId><artifactId>${name}</artifactId><version>1</version>${body}</project>`;
    fs.writeFileSync(path.join(root, 'pom.xml'), pom('example', 'root',
      `<packaging>pom</packaging><modules><module>empty</module><module>docs</module><module>broken</module></modules>
      <repositories><repository><id>central</id><url>${pathToFileURL(path.join(root, 'empty/repo')).href}</url></repository></repositories>`));
    for (const group of ['empty', 'docs', 'broken']) {
      const dir = path.join(root, group);
      const repo = path.join(dir, 'repo');
      fs.mkdirSync(repo, { recursive: true });
      const url = group === 'broken' ? server.url.href : pathToFileURL(repo).href;
      fs.writeFileSync(path.join(dir, 'pom.xml'), pom(group, 'consumer',
        `<repositories><repository><id>central</id><url>${url}</url></repository></repositories>` +
        (group === 'docs' ? '<dependencies><dependency><groupId>example</groupId><artifactId>library</artifactId><version>1</version></dependency></dependencies>' : '')));
      if (group === 'docs') {
        const dest = path.join(repo, 'example/library/1');
        fs.mkdirSync(dest, { recursive: true });
        const java = path.join(root, 'Widget.java');
        fs.writeFileSync(java, 'package example; public class Widget {}');
        execFileSync('javac', ['-d', root, java]);
        fs.writeFileSync(path.join(dest, 'library-1.jar'), zipSync({ 'example/Widget.class': fs.readFileSync(path.join(root, 'example/Widget.class')) }));
        fs.writeFileSync(path.join(dest, 'library-1.pom'), pom('example', 'library', ''));
        fs.writeFileSync(path.join(dest, 'library-1-javadoc.jar'), jar);
      }
    }
  });

  afterAll(() => {
    server.stop(true);
    local.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('uses only the selected module repositories, including for duplicate artifactIds', async () => {
    expect(await resolver.resolveJavadocJar(root, gav, 'empty:consumer')).toEqual({ ok: true, javadocJarPath: null });
    const result = await resolver.resolveJavadocJar(root, gav, 'docs:consumer');
    expect(result.ok ? result.javadocJarPath : result.message).toBe(path.join(local.dir, 'example/library/1/library-1-javadoc.jar'));
    if (result.ok && result.javadocJarPath) expect(fs.readFileSync(result.javadocJarPath)).toEqual(Buffer.from(jar));
  }, 120_000);

  test('reports transfer failures and unknown modules rather than missing docs', async () => {
    const failed = await resolver.resolveJavadocJar(root, { ...gav, version: '2' }, 'broken:consumer');
    expect(failed.ok ? 'unexpected success' : failed.message).toContain('403');
    const missingModule = await resolver.resolveJavadocJar(root, gav, 'consumer');
    expect(missingModule.ok ? 'unexpected success' : missingModule.message).toContain('consumer');
  }, 120_000);

  test('getPackageDocs reads package and type documentation for the consuming module', async () => {
    local.clearGroup('example');
    const previousCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = path.join(local.dir, 'jvmsrc-cache');
    try {
      const result = await getPackageDocs({ projectRoot: root, modulePath: 'docs:consumer', packageName: 'example' });
      expect(result.ok ? result.owners : result.error).toEqual([expect.objectContaining({
        description: 'Example package docs.', docsPath: page, docsSource: 'javadoc-jar',
        types: [{ name: 'Widget', summary: 'A documented widget.', docsSource: 'javadoc-jar' }],
        provenance: expect.objectContaining({ kind: 'external', coordinates: gav, sourcesJarPath: null,
          javadocJarPath: path.join(local.dir, 'example/library/1/library-1-javadoc.jar') }),
      })]);
    } finally {
      if (previousCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
      else process.env.JVMSRC_CACHE_ROOT = previousCache;
    }
  }, 120_000);
});
