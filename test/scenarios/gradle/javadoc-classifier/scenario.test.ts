import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { getPackageDocs } from '../../../../src/get-package-docs.js';
import { GradleResolver } from '../../../../src/resolvers/gradle/index.js';

const wrapper = path.resolve(import.meta.dir, '../local-maven-publish/consumer');
const resolver = new GradleResolver();
const page = 'example/api/package-summary.html';
const docs = zipSync({ [page]: strToU8(`
  <section id="package-description"><div class="block">Greeting utilities.</div></section>
  <table class="typeSummary"><tr><td class="colFirst"><a href="Greeter.html">Greeter</a></td>
  <td class="colLast">Formats a greeting.</td></tr></table>`) });

describe.skipIf(!fs.existsSync(path.join(wrapper, 'gradle/wrapper/gradle-wrapper.jar')))(
  'gradle/javadoc-classifier (real Gradle)', () => {
    let root: string;
    let server: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-javadoc-'));
      const source = path.join(root, 'Greeter.java');
      fs.writeFileSync(source, 'package example.api; public class Greeter {}');
      execFileSync('javac', ['-d', root, source]);
      const entry = 'example/api/Greeter.class';
      const binary = zipSync({ [entry]: fs.readFileSync(path.join(root, entry)) });
      server = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        fetch(request) {
          const resource = new URL(request.url).pathname;
          const match = /^\/example\/lib\/(1|2|3)\/lib-\1(\.pom|\.jar|-javadoc\.jar)$/.exec(resource);
          if (!match) return new Response(null, { status: 404 });
          const [, version, suffix] = match;
          if (suffix === '.pom') return new Response(`<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>lib</artifactId><version>${version}</version></project>`);
          if (suffix === '.jar') return new Response(binary);
          if (version === '1') return new Response(docs);
          return new Response(null, { status: version === '2' ? 404 : 403 });
        },
      });
      for (const file of ['gradlew', 'gradlew.bat', 'gradle/wrapper']) {
        fs.cpSync(path.join(wrapper, file), path.join(root, file), { recursive: true });
      }
      fs.mkdirSync(path.join(root, 'app'));
      fs.writeFileSync(path.join(root, 'settings.gradle'), "rootProject.name = 'consumer'\ninclude 'app'");
      fs.writeFileSync(path.join(root, 'app/build.gradle'),
        `plugins { id 'java' }
         repositories { maven { url = uri('${server.url}'); allowInsecureProtocol = true } }
         dependencies { implementation 'example:lib:1' }`);
    });

    afterAll(() => {
      server.stop(true);
      fs.rmSync(root, { recursive: true, force: true });
    });

    const lookup = (version: string) => resolver.resolveJavadocJar(root, { group: 'example', name: 'lib', version }, ':app');

    test('getPackageDocs returns the dependency type with prose from its javadoc sidecar', async () => {
      const previousCache = process.env.JVMSRC_CACHE_ROOT;
      process.env.JVMSRC_CACHE_ROOT = path.join(root, 'test-cache');
      try {
        const result = await getPackageDocs({ projectRoot: root, modulePath: ':app', packageName: 'example.api' });
        expect(result).toEqual({
          ok: true,
          packageName: 'example.api',
          owners: [{
            description: 'Greeting utilities.', docsPath: page, docsSource: 'javadoc-jar',
            provenance: {
              kind: 'external', coordinates: { group: 'example', name: 'lib', version: '1' },
              jarPath: expect.stringMatching(/[\\/]lib-1\.jar$/), sourcesJarPath: null,
              javadocJarPath: expect.stringMatching(/[\\/]lib-1-javadoc\.jar$/),
            },
            types: [{ name: 'Greeter', summary: 'Formats a greeting.', docsSource: 'javadoc-jar' }],
          }],
        });
      } finally {
        if (previousCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
        else process.env.JVMSRC_CACHE_ROOT = previousCache;
      }
    }, 120_000);

    test('downloads the matching sidecar from the selected module repository', async () => {
      const result = await lookup('1');
      if (!result.ok) throw new Error(result.stderr ?? result.message);
      expect(path.basename(result.javadocJarPath!)).toBe('lib-1-javadoc.jar');
      expect(fs.readFileSync(result.javadocJarPath!)).toEqual(Buffer.from(docs));
    }, 120_000);

    test('returns null when the module exists but has no sidecar', async () => {
      expect(await lookup('2')).toEqual({ ok: true, javadocJarPath: null });
    }, 120_000);

    test('propagates a repository failure fetching the sidecar', async () => {
      const result = await lookup('3');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.stderr).toContain('403');
    }, 120_000);

    test('does not treat an unresolved component as a missing sidecar', async () => {
      const result = await lookup('4');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.stderr).toContain('example:lib:4');
    }, 120_000);
  },
);
