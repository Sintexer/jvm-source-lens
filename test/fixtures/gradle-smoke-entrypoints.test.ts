import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { computeBuildInputsDigest, writeCachedResolution } from '../../src/cache/index.js';
import { createMcpServer } from '../../src/mcp.js';
import type { ResolutionOutput } from '../../src/resolvers/resolution-output.js';

/** MCP and CLI calls against `test/fixtures/gradle-smoke` with a seeded resolution cache: no Gradle run. */
const repoRoot = path.resolve(import.meta.dir, '../..');
const fixtureRoot = path.resolve(import.meta.dir, 'gradle-smoke');
const appPath = path.join(fixtureRoot, 'app');
const appTestFile = path.join(appPath, 'src/test/java/com/smoke/AppSmokeTest.java');

function smokeOutput(): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2026-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '9.0', wrapper: true },
    projectRoot: fixtureRoot,
    modules: [
      {
        name: ':app',
        path: appPath,
        configurations: [
          { name: 'compileClasspath', scope: 'compile', artifacts: [] },
          { name: 'testCompileClasspath', scope: 'test-compile', artifacts: [] },
        ],
      },
    ],
    errors: [],
  };
}

let prevCache: string | undefined;
let tmpCache: string;
let client: Client;

beforeAll(async () => {
  tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-smoke-mcp-'));
  prevCache = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = tmpCache;
  const written = writeCachedResolution(fixtureRoot, smokeOutput(), computeBuildInputsDigest(fixtureRoot));
  expect(written.ok).toBe(true);

  client = new Client({ name: 'smoke-mcp', version: '0.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([createMcpServer().connect(s), client.connect(c)]);
});

afterAll(async () => {
  await client.close();
  if (prevCache === undefined) {
    delete process.env.JVMSRC_CACHE_ROOT;
  } else {
    process.env.JVMSRC_CACHE_ROOT = prevCache;
  }
  fs.rmSync(tmpCache, { recursive: true, force: true });
});

const text = (r: unknown) => JSON.stringify(r);

describe('includeTest inference from a src/test modulePath', () => {
  test('shouldFindTestOnlyClassWhenModulePathIsATestFile', async () => {
    const r = await client.callTool({
      name: 'get_class_source',
      arguments: { className: 'com.smoke.AppSmokeTest', projectRoot: fixtureRoot, modulePath: appTestFile },
    });
    expect((r as { isError?: boolean }).isError).not.toBe(true);
    expect(text(r)).toContain('shouldGreetWhenCoreIsOnClasspath');
  });

  test('shouldNotFindTestOnlyClassWhenIncludeTestIsExplicitlyFalse', async () => {
    const r = await client.callTool({
      name: 'get_class_source',
      arguments: {
        className: 'com.smoke.AppSmokeTest',
        projectRoot: fixtureRoot,
        modulePath: appTestFile,
        includeTest: false,
      },
    });
    expect(text(r)).not.toContain('shouldGreetWhenCoreIsOnClasspath');
  });
});

async function runCli(args: string[], opts: { cwd: string; env?: Record<string, string> }) {
  const proc = Bun.spawn([process.execPath, path.join(repoRoot, 'src/cli.ts'), ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe('CLI without --project', () => {
  test('shouldLiftToGradleRootWhenCwdIsAModuleSubdirectory', async () => {
    const r = await runCli(['resolve'], { cwd: path.join(appPath, 'src') });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(':app');
  });

  test('shouldUseJvmsrcProjectRootWhenCwdIsOutsideAnyProject', async () => {
    const r = await runCli(['resolve'], { cwd: os.tmpdir(), env: { JVMSRC_PROJECT_ROOT: fixtureRoot } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(':app');
  });

  test('shouldPrintLiftNoteOnStderrWhenProjectIsASubdirectory', async () => {
    const r = await runCli(['resolve', '--project', appPath], { cwd: os.tmpdir() });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(`[jvmsrc] projectRoot ${appPath} is inside the Gradle project at ${fixtureRoot}`);
  });

  test('shouldReadTestSourceWhenModuleIsATestFile', async () => {
    const r = await runCli(['get', 'com.smoke.AppSmokeTest', '-m', appTestFile, '--quiet'], { cwd: fixtureRoot });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('shouldGreetWhenCoreIsOnClasspath');
  });
});
