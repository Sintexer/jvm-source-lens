import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { strToU8, zipSync } from 'fflate';
import { buildClassFile } from '../../src/extractor/test-class-file.js';
import { getClassSource } from '../../src/get-class-source.js';
import { createMcpServer } from '../../src/mcp.js';
import { resolveProjectRoot } from '../../src/project-path.js';
import { resolveWithResolutionCache } from '../../src/resolve-with-cache.js';
import type { DependencyResolver, ResolutionOutput } from '../../src/resolvers/base.js';
import { GradleResolver, registerResolverForTesting } from '../../src/resolvers/index.js';
import { searchClasses } from '../../src/search-classes.js';
import { searchInArtifact } from '../../src/search-in-artifact.js';

const MARKER = 'jvmsrc-fake.json';

describe('pluggable fake resolver end-to-end', () => {
  let tmpRoot: string;
  let projectDir: string;
  let subDir: string;
  let binaryJarPath: string;
  let sourcesJarPath: string;
  let prevCacheRoot: string | undefined;
  let prevLogDir: string | undefined;
  let restoreResolver: (() => void) | undefined;

  let resolveCalls = 0;
  let cacheInputsCalls = 0;
  let sourcesCalls = 0;

  beforeEach(() => {
    resolveCalls = 0;
    cacheInputsCalls = 0;
    sourcesCalls = 0;

    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-fake-e2e-')));
    projectDir = path.join(tmpRoot, 'workspace');
    subDir = path.join(projectDir, 'module-a', 'src', 'main', 'java');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, MARKER), JSON.stringify({ version: 1 }), 'utf8');

    const jarsDir = path.join(tmpRoot, 'repo');
    fs.mkdirSync(jarsDir, { recursive: true });
    binaryJarPath = path.join(jarsDir, 'greeter-lib-1.0.0.jar');
    sourcesJarPath = path.join(jarsDir, 'greeter-lib-1.0.0-sources.jar');

    fs.writeFileSync(
      binaryJarPath,
      zipSync({
        'com/fake/Greeter.class': buildClassFile({
          internalName: 'com/fake/Greeter',
          sourceFile: 'Greeter.java',
        }),
      }),
    );

    const javaSource = [
      'package com.fake;',
      '',
      'public class Greeter {',
      '  public String greet(String who) {',
      '    return "fake-hello:" + who;',
      '  }',
      '}',
      '',
    ].join('\n');

    fs.writeFileSync(
      sourcesJarPath,
      zipSync({
        'com/fake/Greeter.java': strToU8(javaSource),
      }),
    );

    prevCacheRoot = process.env.JVMSRC_CACHE_ROOT;
    prevLogDir = process.env.JVMSRC_LOG_DIR;
    process.env.JVMSRC_CACHE_ROOT = path.join(tmpRoot, 'cache');
    process.env.JVMSRC_LOG_DIR = path.join(tmpRoot, 'logs');

    const fakeResolver: DependencyResolver = {
      id: 'fake',
      displayName: 'FakeBuild',
      rootHint: MARKER,
      detect: (root) => fs.existsSync(path.join(root, MARKER)),
      findBuildRoot: (start) => {
        let dir = path.resolve(start);
        for (;;) {
          if (fs.existsSync(path.join(dir, MARKER))) {
            return dir;
          }
          const parent = path.dirname(dir);
          if (parent === dir) {
            return null;
          }
          dir = parent;
        }
      },
      cacheInputs: () => {
        cacheInputsCalls++;
        return { files: [MARKER], env: [['FAKE_REPO', jarsDir]] };
      },
      isImmutableArtifact: () => true,
      resolve: async (root, opts) => {
        opts?.onBeforeResolve?.({ resolverId: 'fake', displayName: 'FakeBuild' });
        try {
          resolveCalls++;
          const output: ResolutionOutput = {
            schemaVersion: '1.2',
            resolvedAt: '2026-11-17T00:00:00Z',
            buildSystem: { type: 'fake', version: '0.1.0', wrapper: false },
            projectRoot: root,
            modules: [
              {
                name: 'root',
                path: root,
                configurations: [
                  {
                    name: 'compile',
                    scope: 'compile',
                    artifacts: [
                      {
                        group: 'com.fake',
                        name: 'greeter-lib',
                        version: '1.0.0',
                        type: 'jar',
                        jarPath: binaryJarPath,
                        sourcesJarPath: null,
                        origin: 'external',
                        direct: true,
                      },
                    ],
                  },
                ],
              },
            ],
            errors: [],
          };
          return { ok: true, output };
        } finally {
          opts?.onAfterResolve?.();
        }
      },
      resolveSourcesJar: async (_root, coords, hooks) => {
        hooks?.onBeforeResolve?.({ resolverId: 'fake', displayName: 'FakeBuild' });
        try {
          sourcesCalls++;
          if (coords.group === 'com.fake' && coords.name === 'greeter-lib') {
            return { ok: true, sourcesJarPath };
          }
          return { ok: true, sourcesJarPath: null };
        } finally {
          hooks?.onAfterResolve?.();
        }
      },
    };

    restoreResolver = registerResolverForTesting(fakeResolver);
  });

  afterEach(() => {
    restoreResolver?.();
    if (prevCacheRoot === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCacheRoot;
    }
    if (prevLogDir === undefined) {
      delete process.env.JVMSRC_LOG_DIR;
    } else {
      process.env.JVMSRC_LOG_DIR = prevLogDir;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('runs project-root lifting, cached resolve, getClassSource, searchClasses, searchInArtifact, and MCP without spawning Gradle', async () => {
    const gradleResolveSpy = spyOn(GradleResolver.prototype, 'resolve');
    const gradleSourcesSpy = spyOn(GradleResolver.prototype, 'resolveSourcesJar');
    try {
      // 1. Project-root lifting uses fakeResolver.findBuildRoot + displayName
      const lifted = resolveProjectRoot(subDir);
      expect(lifted).toEqual({
        ok: true,
        path: projectDir,
        note: `projectRoot ${subDir} is inside the FakeBuild project at ${projectDir}; using that.`,
      });

      // 2. getClassSource resolves, caches, and fetches sources on demand via fakeResolver
      const srcRes = await getClassSource('com.fake.Greeter', {
        projectRoot: projectDir,
        excerpt: { methodNames: ['greet'] },
      });
      expect(srcRes.ok).toBe(true);
      if (srcRes.ok) {
        expect(srcRes.sourceAvailable).toBe(true);
        expect(srcRes.sourceLanguage).toBe('java');
        expect(srcRes.source).toContain('fake-hello:');
        expect(srcRes.provenance.kind).toBe('sourcesJar');
      }
      expect(resolveCalls).toBe(1);
      expect(sourcesCalls).toBe(1);
      expect(cacheInputsCalls).toBeGreaterThan(0);

      // Warm cache hit does not re-run fakeResolver.resolve; editing marker invalidates cache
      const warm = await resolveWithResolutionCache(projectDir);
      expect(warm.ok).toBe(true);
      if (warm.ok) {
        expect(warm.output.buildSystem.type).toBe('fake');
      }
      expect(resolveCalls).toBe(1);

      fs.writeFileSync(path.join(projectDir, MARKER), JSON.stringify({ version: 2 }), 'utf8');
      const invalidated = await resolveWithResolutionCache(projectDir);
      expect(invalidated.ok).toBe(true);
      expect(resolveCalls).toBe(2);

      // 3. search_classes indexes the fake classpath and finds Greeter
      const clsSearch = await searchClasses({
        projectRoot: projectDir,
        query: 'Greeter',
      });
      expect(clsSearch.ok).toBe(true);
      if (clsSearch.ok) {
        expect(clsSearch.hits.map((h) => h.className)).toEqual(['com.fake.Greeter']);
      }

      // 4. search_in_artifact routes sources-JAR lookup through fakeResolver
      const beforeArtifactSourcesCalls = sourcesCalls;
      const artSearch = await searchInArtifact({
        projectRoot: projectDir,
        selector: { coordinates: { group: 'com.fake', name: 'greeter-lib' } },
        query: 'fake-hello:',
      });
      expect(artSearch.ok).toBe(true);
      if (artSearch.ok && artSearch.found) {
        expect(artSearch.hits.map((h) => h.className)).toEqual(['com.fake.Greeter']);
        expect(artSearch.hits[0]?.sourceAvailable).toBe(true);
      }
      expect(sourcesCalls).toBe(beforeArtifactSourcesCalls + 1);

      // 5. MCP resolve_dependencies surfaces buildSystem.type === 'fake' and instructions include FakeBuild
      const server = createMcpServer();
      const client = new Client({ name: 'fake-e2e', version: '0.0.0' });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);
      try {
        expect(client.getInstructions()).toContain('FakeBuild, Gradle and Maven projects only.');
        const toolRes = await client.callTool({
          name: 'resolve_dependencies',
          arguments: { projectRoot: projectDir, full: true },
        });
        expect((toolRes as { isError?: boolean }).isError).not.toBe(true);
        const structured = (toolRes as { structuredContent?: { buildSystem?: { type?: string } } })
          .structuredContent;
        expect(structured?.buildSystem?.type).toBe('fake');
      } finally {
        await client.close();
      }

      expect(gradleResolveSpy).not.toHaveBeenCalled();
      expect(gradleSourcesSpy).not.toHaveBeenCalled();
    } finally {
      gradleResolveSpy.mockRestore();
      gradleSourcesSpy.mockRestore();
    }
  });

  test('get_package_docs returns source-backed prose and ownership using the client workspace', async () => {
    const workspacePackage = path.join(projectDir, 'src/main/java/com/fake');
    fs.mkdirSync(workspacePackage, { recursive: true });
    fs.writeFileSync(path.join(workspacePackage, 'package-info.java'), '/** Workspace greetings. */\npackage com.fake;');
    fs.writeFileSync(sourcesJarPath, zipSync({
      'com/fake/package-info.java': strToU8('/** Greeting utilities. */\npackage com.fake;'),
      'com/fake/Greeter.java': strToU8('package com.fake;\n/** Sends a greeting. */\npublic class Greeter {}'),
    }));
    const server = createMcpServer();
    const client = new Client({ name: 'package-test', version: '1' }, { capabilities: { roots: {} } });
    client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{ uri: pathToFileURL(projectDir).href }] }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const call = (packageName: string) => client.callTool({ name: 'get_package_docs', arguments: { packageName } });
      const result = await call('com.fake');
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: true, packageName: 'com.fake' });
      expect(result.structuredContent?.owners).toEqual(expect.arrayContaining([
        expect.objectContaining({ description: 'Workspace greetings.', provenance: expect.objectContaining({ moduleName: 'root' }) }),
        expect.objectContaining({ description: 'Greeting utilities.', provenance: expect.objectContaining({ sourcesJarPath }) }),
      ]));
      for (const representation of [result.content, result.structuredContent]) {
        const value = JSON.stringify(representation);
        for (const expected of ['Workspace greetings.', 'Greeting utilities.', 'Greeter', 'Sends a greeting.', 'greeter-lib', sourcesJarPath, 'com/fake/package-info.java']) {
          expect(value).toContain(expected);
        }
      }
      const missing = await call('com.absent');
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toMatchObject({ ok: false, error: { code: 'DOCS_NOT_FOUND', message: expect.any(String) } });
      expect(JSON.stringify(missing.content)).toContain('DOCS_NOT_FOUND');
      expect(JSON.stringify(missing.content)).toContain('com.absent');
    } finally {
      await client.close();
    }
  });

  test('emits dynamic CLI progress labels using resolver.displayName', async () => {
    const origIsTTY = process.stderr.isTTY;
    const origConsoleError = console.error;
    const stderrLines: string[] = [];
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
    console.error = ((msg: unknown) => {
      stderrLines.push(String(msg));
    }) as typeof console.error;
    try {
      const res = await getClassSource('com.fake.Greeter', {
        projectRoot: projectDir,
        forceRefresh: true,
        cli: { progress: true },
      });
      expect(res.ok).toBe(true);
      expect(stderrLines).toContain('[jvmsrc] Resolving dependencies (FakeBuild)…');
      expect(stderrLines).toContain('[jvmsrc] Resolving sources JAR (FakeBuild)…');
    } finally {
      console.error = origConsoleError;
      Object.defineProperty(process.stderr, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });
});
