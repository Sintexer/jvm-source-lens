import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { getClassStructure } from '../../../../src/get-class-structure.js';
import { getMethodSignatures } from '../../../../src/get-method-signatures.js';
import { getMethodSignaturesBytecode } from '../../../../src/get-method-signatures-bytecode.js';
import { getPackageDocs } from '../../../../src/get-package-docs.js';
import { searchInArtifact } from '../../../../src/search-in-artifact.js';
import { GradleResolver } from '../../../../src/resolvers/gradle/index.js';

const wrapper = path.resolve(import.meta.dir, '../local-maven-publish/consumer');
const resolver = new GradleResolver();
const page = 'example/api/package-summary.html';
const packageHtml = strToU8(`
  <section id="package-description"><div class="block">Greeting utilities.</div></section>
  <table class="typeSummary"><tr><td class="colFirst"><a href="Greeter.html">Greeter</a></td>
  <td class="colLast">Formats a greeting.</td></tr></table>`);

describe.skipIf(!fs.existsSync(path.join(wrapper, 'gradle/wrapper/gradle-wrapper.jar')))(
  'gradle/javadoc-classifier (real Gradle)', () => {
    let root: string;
    let docs: Uint8Array<ArrayBuffer>;
    let server: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-javadoc-'));
      const source = path.join(root, 'Greeter.java');
      fs.writeFileSync(source, `package example.api;
        /** Greets callers by name or number. */
        public class Greeter {
          /** Greets the named caller. */
          public void greet(String name) {}
          /** Greets the numbered caller. */
          public void greet(int number) {}
        }`);
      execFileSync('javac', ['-d', root, source]);
      execFileSync('javadoc', ['-quiet', '-notimestamp', '-Xdoclint:none', '-d', path.join(root, 'html'), source]);
      const classPage = 'example/api/Greeter.html';
      docs = zipSync({ [page]: packageHtml, [classPage]: fs.readFileSync(path.join(root, 'html', classPage)) });
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

    test('class and signature lookups attach classifier prose to the exact bytecode overload', async () => {
      const previousCache = process.env.JVMSRC_CACHE_ROOT;
      process.env.JVMSRC_CACHE_ROOT = path.join(root, 'test-cache');
      try {
        const opts = { projectRoot: root, modulePath: ':app' };
        const type = 'example.api.Greeter';
        const structure = await getClassStructure(type, opts);
        if (!structure.ok) throw new Error(structure.error.message);
        const signatures = await getMethodSignatures(type, 'greet', opts);
        if (!signatures.ok) throw new Error(signatures.error.message);
        const raw = await getMethodSignaturesBytecode(type, 'greet', opts);
        if (!raw.ok) throw new Error(raw.error.message);

        expect(raw.sourceAvailable).toBe(false);
        expect(raw).not.toHaveProperty('docsSource');
        expect(raw.overloads.map(o => o.jvmDescriptor).sort()).toEqual(['(I)V', '(Ljava/lang/String;)V']);
        for (const overload of raw.overloads) {
          expect(overload).not.toHaveProperty('javadoc');
          expect(overload).not.toHaveProperty('docsSource');
        }
        expect(structure).toMatchObject({ sourceAvailable: false, docsSource: 'javadoc-jar', classPurpose: 'Greets callers by name or number.' });
        expect(signatures.sourceAvailable).toBe(false);
        for (const rows of [structure.methods.filter(m => m.name === 'greet'), signatures.overloads]) {
          expect(rows).toHaveLength(2);
          expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ jvmDescriptor: '(I)V', javadoc: 'Greets the numbered caller.', docsSource: 'javadoc-jar' }),
            expect.objectContaining({ jvmDescriptor: '(Ljava/lang/String;)V', javadoc: 'Greets the named caller.', docsSource: 'javadoc-jar' }),
          ]));
        }
      } finally {
        if (previousCache === undefined) delete process.env.JVMSRC_CACHE_ROOT;
        else process.env.JVMSRC_CACHE_ROOT = previousCache;
      }
    }, 120_000);

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

    test('search_in_artifact docs=true finds class-page prose from the Javadoc sidecar only', async () => {
      const previousCache = process.env.JVMSRC_CACHE_ROOT;
      process.env.JVMSRC_CACHE_ROOT = path.join(root, 'test-cache-search');
      try {
        const base = { projectRoot: root, modulePath: ':app', selector: { coordinates: { group: 'example', name: 'lib', version: '1' } } };
        const docsHit = await searchInArtifact({ ...base, query: 'Greets', docs: true });
        expect(docsHit).toMatchObject({ ok: true, found: true, docs: true,
          hits: [{ className: 'example.api.Greeter', sourceAvailable: false }] });
        // Package summary prose is not a class page, so it must not match.
        expect(await searchInArtifact({ ...base, query: 'Greeting utilities', docs: true })).toMatchObject({ ok: true, hitCount: 0 });
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
