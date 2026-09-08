import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getBundledResource } from '../bundled-resources.js';
import { resolveJavaExecutable } from './resolve-java-executable.js';
import { escapeCfrJarFilter, runCfrDecompile } from './spawn-cfr.js';

function hasJavaTooling(): boolean {
  const java = resolveJavaExecutable();
  if (!java.ok) {
    return false;
  }
  try {
    execSync(`${java.javaPath} -version`, { stdio: 'ignore' });
    execSync('javac -version', { stdio: 'ignore' });
    execSync('jar --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasCfrJar(): boolean {
  try {
    getBundledResource('cfr.jar');
    return true;
  } catch {
    return false;
  }
}

const canRunIntegration = hasJavaTooling() && hasCfrJar();

describe('escapeCfrJarFilter', () => {
  test('escapes dots and dollar for inner classes', () => {
    expect(escapeCfrJarFilter('com.example.Beta')).toBe('com\\.example\\.Beta');
    expect(escapeCfrJarFilter('com.example.Outer$Inner')).toBe('com\\.example\\.Outer\\$Inner');
  });
});

describe('runCfrDecompile', () => {
  test.skipIf(!canRunIntegration)('decompiles a class from a minimal JAR', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfr-'));
    const javaFile = path.join(dir, 'Hello.java');
    fs.writeFileSync(
      javaFile,
      'package com.jvmsrc.test;\npublic class Hello { public String greet() { return "hi"; } }\n',
    );
    execSync('javac -d . Hello.java', { cwd: dir });
    const classFile = path.join(dir, 'com', 'jvmsrc', 'test', 'Hello.class');
    expect(fs.existsSync(classFile)).toBe(true);
    const jarPath = path.join(dir, 'hello.jar');
    execSync(`jar cf hello.jar -C . com/jvmsrc/test/Hello.class`, { cwd: dir });

    const java = resolveJavaExecutable();
    expect(java.ok).toBe(true);

    const r = await runCfrDecompile({
      jarPath,
      className: 'com.jvmsrc.test.Hello',
      javaPath: java.ok ? java.javaPath : undefined,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('class Hello');
    }
  });

  test.skipIf(!canRunIntegration)(
    'decompiles only the requested class from a multi-class JAR',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-cfr-multi-'));
      for (const name of ['Alpha', 'Beta', 'Gamma'] as const) {
        fs.writeFileSync(
          path.join(dir, `${name}.java`),
          `package com.example;\npublic class ${name} { public int n() { return ${name === 'Alpha' ? 1 : name === 'Beta' ? 2 : 3}; } }\n`,
        );
      }
      execSync('javac -d . Alpha.java Beta.java Gamma.java', { cwd: dir });
      execSync(
        'jar cf lib.jar -C . com/example/Alpha.class com/example/Beta.class com/example/Gamma.class',
        { cwd: dir },
      );
      const jarPath = path.join(dir, 'lib.jar');

      const java = resolveJavaExecutable();
      expect(java.ok).toBe(true);

      const r = await runCfrDecompile({
        jarPath,
        className: 'com.example.Beta',
        javaPath: java.ok ? java.javaPath : undefined,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.source).toContain('class Beta');
        expect(r.source).not.toContain('class Alpha');
        expect(r.source).not.toContain('class Gamma');
      }
    },
  );
});
