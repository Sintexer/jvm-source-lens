import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClassSearchIndex } from './build-class-search-index.js';
import { listFqnsFromInterprojectSources } from './interproject-source-fqns.js';

describe('interproject-source-fqns', () => {
  test('derives FQN from src/main/java tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-ipj-'));
    const javaPath = path.join(dir, 'src/main/java/com/example/MyType.java');
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    fs.writeFileSync(javaPath, 'package com.example;\nclass MyType {}\n');

    const r = listFqnsFromInterprojectSources(dir, false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fqns).toEqual(['com.example.MyType']);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('shouldUsePackageLineWhenKotlinDirectoryDiffers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-ipj-'));
    const ktPath = path.join(dir, 'src/main/kotlin/not/the/package/Greeter.kt');
    fs.mkdirSync(path.dirname(ktPath), { recursive: true });
    fs.writeFileSync(ktPath, '@file:JvmName("GreeterKt")\npackage com.acme\n\nfun hello() = 1\n');

    const r = listFqnsFromInterprojectSources(dir, false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fqns).toEqual(['com.acme.Greeter']);
      expect(r.files[0]?.absolutePath).toBe(ktPath);
    }

    const indexed = buildClassSearchIndex({
      module: { name: ':lib', path: dir, configurations: [] },
      configuration: { name: 'compileClasspath', scope: 'compile', artifacts: [] },
      includeTest: false,
      buildInputsDigest: 'd',
      resolutionFingerprint: 'f',
    });
    expect(indexed.ok).toBe(true);
    if (indexed.ok) {
      expect(indexed.file.entries.map((entry) => entry.className)).toEqual(['com.acme.Greeter']);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('shouldUseFileNameWhenSourceHasNoPackage', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-ipj-'));
    const ktPath = path.join(dir, 'src/main/kotlin/com/acme/Lone.kt');
    fs.mkdirSync(path.dirname(ktPath), { recursive: true });
    fs.writeFileSync(ktPath, 'fun lone() = 1\n');

    const r = listFqnsFromInterprojectSources(dir, false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fqns).toEqual(['Lone']);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('shouldIncludeTestSourcesOnlyWhenRequested', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-ipj-'));
    const scalaPath = path.join(dir, 'src/test/scala/com/acme/Spec.scala');
    fs.mkdirSync(path.dirname(scalaPath), { recursive: true });
    fs.writeFileSync(scalaPath, 'package com.acme\nclass Spec\n');

    const mainOnly = listFqnsFromInterprojectSources(dir, false);
    expect(mainOnly.ok).toBe(true);
    if (mainOnly.ok) {
      expect(mainOnly.fqns).toEqual([]);
    }
    const withTest = listFqnsFromInterprojectSources(dir, true);
    expect(withTest.ok).toBe(true);
    if (withTest.ok) {
      expect(withTest.fqns).toEqual(['com.acme.Spec']);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
