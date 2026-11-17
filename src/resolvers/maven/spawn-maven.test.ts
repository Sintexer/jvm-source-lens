import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_MAVEN_TIMEOUT_MS,
  mavenTimeoutMs,
  mergeMavenExtClassPath,
  runMavenAnalyzer,
} from './spawn-maven.js';

describe('mavenTimeoutMs', () => {
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.JVMSRC_MAVEN_TIMEOUT_MS;
    } else {
      process.env.JVMSRC_MAVEN_TIMEOUT_MS = saved;
    }
  });

  test('defaults to DEFAULT_MAVEN_TIMEOUT_MS and parses positive overrides', () => {
    saved = process.env.JVMSRC_MAVEN_TIMEOUT_MS;
    delete process.env.JVMSRC_MAVEN_TIMEOUT_MS;
    expect(mavenTimeoutMs()).toBe(DEFAULT_MAVEN_TIMEOUT_MS);

    process.env.JVMSRC_MAVEN_TIMEOUT_MS = '45000';
    expect(mavenTimeoutMs()).toBe(45000);

    process.env.JVMSRC_MAVEN_TIMEOUT_MS = '-5';
    expect(mavenTimeoutMs()).toBe(DEFAULT_MAVEN_TIMEOUT_MS);
  });
});

describe('mergeMavenExtClassPath', () => {
  test('returns analyzerJar alone when .mvn/maven.config has no maven.ext.class.path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extcp-'));
    try {
      expect(mergeMavenExtClassPath(dir, '/bundled/maven-analyzer.jar')).toBe(
        '/bundled/maven-analyzer.jar',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('appends analyzerJar with path.delimiter when .mvn/maven.config sets -Dmaven.ext.class.path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-extcp-merge-'));
    try {
      fs.mkdirSync(path.join(dir, '.mvn'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.mvn', 'maven.config'),
        '# comment\n-T 4\n-Dmaven.ext.class.path=/proj/.mvn/custom-ext.jar\n',
        'utf8',
      );
      expect(mergeMavenExtClassPath(dir, '/bundled/maven-analyzer.jar')).toBe(
        `/proj/.mvn/custom-ext.jar${path.delimiter}/bundled/maven-analyzer.jar`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runMavenAnalyzer guards', () => {
  test('stops with actionable message when maven-wrapper.jar is a Git LFS pointer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-lfs-'));
    const savedUseSys = process.env.JVMSRC_USE_SYSTEM_MAVEN;
    delete process.env.JVMSRC_USE_SYSTEM_MAVEN;
    try {
      fs.writeFileSync(path.join(dir, 'mvnw'), '#!/bin/sh\n', { mode: 0o755 });
      fs.mkdirSync(path.join(dir, '.mvn', 'wrapper'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.mvn', 'wrapper', 'maven-wrapper.jar'),
        'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 100\n',
      );
      const res = await runMavenAnalyzer(dir, ['-Djvmsrc.mode=resolve']);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toContain('Git LFS pointer');
      }
    } finally {
      if (savedUseSys !== undefined) {
        process.env.JVMSRC_USE_SYSTEM_MAVEN = savedUseSys;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('stops before spawning Maven when pom.xml requires an unavailable JDK major', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-jdk99-'));
    const savedJavaHome = process.env.JVMSRC_JAVA_HOME;
    delete process.env.JVMSRC_JAVA_HOME;
    try {
      fs.writeFileSync(
        path.join(dir, 'pom.xml'),
        '<project><properties><maven.compiler.release>99</maven.compiler.release></properties></project>\n',
        'utf8',
      );
      const res = await runMavenAnalyzer(dir, ['-Djvmsrc.mode=resolve']);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toContain('Java 99');
      }
    } finally {
      if (savedJavaHome !== undefined) {
        process.env.JVMSRC_JAVA_HOME = savedJavaHome;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
