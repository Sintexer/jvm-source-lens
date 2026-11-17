import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { zipSync } from 'fflate';
import { getClassSource } from '../../../../src/get-class-source.js';
import { getClassStructure } from '../../../../src/get-class-structure.js';
import { resolveProjectRoot } from '../../../../src/project-path.js';
import { searchClasses } from '../../../../src/search-classes.js';

setDefaultTimeout(120_000);

const scenarioRoot = fs.realpathSync(path.resolve(import.meta.dir));
const coreRoot = path.join(scenarioRoot, 'core');
const appRoot = path.join(scenarioRoot, 'services', 'app');
const wrapperJar = path.join(scenarioRoot, '.mvn/wrapper/maven-wrapper.jar');

const scenarioReady = fs.existsSync(wrapperJar);
const m2ReactorNamespace = path.join(os.homedir(), '.m2', 'repository', 'com', 'acme', 'reactor');

function buildLegacySystemJar(destJar: string): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-sysjar-'));
  try {
    const srcDir = path.join(work, 'src', 'com', 'legacy');
    const clsDir = path.join(work, 'classes');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(clsDir, { recursive: true });
    const javaFile = path.join(srcDir, 'LegacyToken.java');
    fs.writeFileSync(
      javaFile,
      [
        'package com.legacy;',
        'public class LegacyToken {',
        '  public int magicCode() {',
        '    return 7788;',
        '  }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const javac = process.env.JAVA_HOME
      ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
      : 'javac';
    const res = spawnSync(javac, ['--release', '8', '-d', clsDir, javaFile], { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`javac failed building LegacyToken.jar: ${res.stderr || res.stdout}`);
    }
    const classBytes = new Uint8Array(
      fs.readFileSync(path.join(clsDir, 'com', 'legacy', 'LegacyToken.class')),
    );
    fs.writeFileSync(destJar, zipSync({ 'com/legacy/LegacyToken.class': classBytes }));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function runMvnw(projectDir: string, ...args: string[]): Promise<void> {
  const mvnw = path.join(scenarioRoot, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  const proc = Bun.spawn([mvnw, '-B', '-q', ...args], {
    cwd: projectDir,
    env: { ...process.env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Maven ${args.join(' ')} exited with ${code}`);
  }
}

const appLibsDir = path.join(appRoot, 'libs');

if (scenarioReady) {
  beforeAll(() => {
    fs.rmSync(m2ReactorNamespace, { recursive: true, force: true });
    fs.rmSync(path.join(coreRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(path.join(appRoot, 'target'), { recursive: true, force: true });
    fs.mkdirSync(appLibsDir, { recursive: true });
    buildLegacySystemJar(path.join(appLibsDir, 'legacy-sdk-1.0.jar'));
  });

  afterAll(() => {
    fs.rmSync(appLibsDir, { recursive: true, force: true });
    fs.rmSync(path.join(coreRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(path.join(appRoot, 'target'), { recursive: true, force: true });
    fs.rmSync(m2ReactorNamespace, { recursive: true, force: true });
  });
}

describe.skipIf(!scenarioReady)('maven/multi-module scenario (real Maven)', () => {
  let prevCache: string | undefined;
  let tmpCache = '';

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-mm-cache-'));
    prevCache = process.env.JVMSRC_CACHE_ROOT;
    process.env.JVMSRC_CACHE_ROOT = tmpCache;
  });

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env.JVMSRC_CACHE_ROOT;
    } else {
      process.env.JVMSRC_CACHE_ROOT = prevCache;
    }
    fs.rmSync(tmpCache, { recursive: true, force: true });
  });

  test('shouldLiftSubdirResolveUncompiledInterprojectSourcesDecompileSystemJarAndUseTargetClassesForJavap', async () => {
    // 1. Subdirectory inside nested module `services/app/...` lifts all the way to reactor root
    const lifted = resolveProjectRoot(path.join(appRoot, 'src', 'main', 'java'));
    expect(lifted.ok).toBe(true);
    if (lifted.ok) {
      expect(lifted.path).toBe(scenarioRoot);
    }

    // 2. Uncompiled reactor (no target/ anywhere, sibling never `mvn install`ed):
    //    `acme-app`, relative dir `services/app`, and source file path all resolve `acme-core` Java + Kotlin sources.
    for (const modulePath of [
      'acme-app',
      'services/app',
      'services/app/src/main/java/com/acme/app/AppRunner.java',
    ]) {
      const src = await getClassSource('com.acme.core.CoreGreeter', {
        projectRoot: scenarioRoot,
        modulePath,
      });
      expect(src.ok).toBe(true);
      if (src.ok) {
        expect(src.sourceAvailable).toBe(true);
        expect(src.sourceLanguage).toBe('java');
        expect(src.provenance.kind).toBe('interproject');
        expect(src.source).toContain('basePrefix() + name');
      }
    }

    const ktClass = await getClassSource('com.acme.core.KtNote', {
      projectRoot: scenarioRoot,
      modulePath: 'acme-app',
    });
    expect(ktClass.ok).toBe(true);
    if (ktClass.ok) {
      expect(ktClass.sourceAvailable).toBe(true);
      expect(ktClass.sourceLanguage).toBe('kotlin');
      expect(ktClass.provenance.kind).toBe('interproject');
    }

    expect(fs.existsSync(path.join(coreRoot, 'target'))).toBe(false);
    expect(fs.existsSync(path.join(appRoot, 'target'))).toBe(false);

    // 3. system-scope JAR (`origin: local-file`): indexed by search_classes and decompiled by CFR
    const searchSys = await searchClasses({
      projectRoot: scenarioRoot,
      modulePath: 'acme-app',
      query: 'LegacyToken',
    });
    expect(searchSys.ok).toBe(true);
    if (searchSys.ok) {
      expect(searchSys.hits.map((h) => h.className)).toEqual(['com.legacy.LegacyToken']);
    }

    const sysDecompiled = await getClassSource('com.legacy.LegacyToken', {
      projectRoot: scenarioRoot,
      modulePath: 'acme-app',
    });
    expect(sysDecompiled.ok).toBe(true);
    if (sysDecompiled.ok) {
      expect(sysDecompiled.sourceAvailable).toBe(false);
      expect(sysDecompiled.source).toContain('7788');
    }

    // 4. Compile ONLY `core` (not `mvn install`, and `services/app/target` still absent):
    //    `core/target/classes` backs effective javap hierarchy and Kotlin `*Kt` facade SourceFile!
    await runMvnw(scenarioRoot, '-pl', 'core', 'compile');
    expect(fs.existsSync(path.join(coreRoot, 'target', 'classes'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, 'target'))).toBe(false);

    const effective = await getClassStructure('com.acme.core.CoreGreeter', {
      projectRoot: scenarioRoot,
      modulePath: 'acme-app',
      scope: 'effective',
    });
    expect(effective.ok).toBe(true);
    if (effective.ok) {
      expect(effective.methods.some((m) => m.name === 'basePrefix' && m.inherited)).toBe(true);
    }

    const ktFacade = await getClassSource('com.acme.core.KtNotesKt', {
      projectRoot: scenarioRoot,
      modulePath: 'acme-app',
      excerpt: { methodNames: ['formatNote'] },
    });
    expect(ktFacade.ok).toBe(true);
    if (ktFacade.ok) {
      expect(ktFacade.sourceAvailable).toBe(true);
      expect(ktFacade.sourceLanguage).toBe('kotlin');
      expect(ktFacade.source).toContain('Formats a bracketed note tag');
      expect(ktFacade.source).toContain('fun formatNote');
    }

    expect(fs.existsSync(path.join(appRoot, 'target'))).toBe(false);
  });
});
