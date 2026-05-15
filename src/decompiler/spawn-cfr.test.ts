import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getBundledResource } from '../bundled-resources.js';
import { resolveJavaExecutable } from './resolve-java-executable.js';
import { runCfrDecompile } from './spawn-cfr.js';

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
});
