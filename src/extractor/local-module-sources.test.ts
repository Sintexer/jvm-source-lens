import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { extractExternalClassSource } from './extract-external-class-source.js';
import { pickResolvedConfiguration } from './pick-classpath.js';
import { tryReadLocalModuleJavaSource } from './local-module-sources.js';

describe('local module test sources', () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tryReadLocalModuleJavaSource finds src/test/java in the queried module', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-local-'));
    const javaPath = path.join(dir, 'src/test/java/com/app/MyTest.java');
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    fs.writeFileSync(javaPath, 'package com.app;\npublic class MyTest {}\n');

    const module = { name: ':app', path: dir, configurations: [] };
    const r = await tryReadLocalModuleJavaSource(module, 'com/app/MyTest.java', 'com.app.MyTest', true);
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.provenance.kind).toBe('interproject');
      expect(r.provenance.moduleRoot).toBe(dir);
    }
  });

  test('extractExternalClassSource finds same-module test class with includeTest', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-local-'));
    const javaPath = path.join(dir, 'src/test/java/com/app/OnlyTest.java');
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    fs.writeFileSync(javaPath, 'package com.app;\npublic class OnlyTest {}\n');

    const output: ResolutionOutput = {
      schemaVersion: '1.1',
      resolvedAt: '2020-01-01T00:00:00Z',
      buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
      projectRoot: dir,
      modules: [
        {
          name: ':app',
          path: dir,
          configurations: [
            {
              name: 'testCompileClasspath',
              scope: 'test-compile',
              artifacts: [],
            },
          ],
        },
      ],
      errors: [],
    };

    const r = await extractExternalClassSource(output, {
      className: 'com.app.OnlyTest',
      modulePath: ':app',
      includeTest: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('OnlyTest');
    }
  });

  test('pickResolvedConfiguration falls back to jvmTestCompileClasspath', () => {
    const output: ResolutionOutput = {
      schemaVersion: '1.1',
      resolvedAt: '2020-01-01T00:00:00Z',
      buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
      projectRoot: '/tmp/p',
      modules: [
        {
          name: 'root',
          path: '/tmp/p',
          configurations: [
            {
              name: 'jvmTestCompileClasspath',
              scope: 'test-compile',
              artifacts: [],
            },
          ],
        },
      ],
      errors: [],
    };
    const r = pickResolvedConfiguration(output, { includeTest: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.configuration.name).toBe('jvmTestCompileClasspath');
    }
  });
});
