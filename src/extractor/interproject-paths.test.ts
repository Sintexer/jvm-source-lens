import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  candidateInterprojectSourcePaths,
  interprojectBytecodeRootSuffixes,
  resolveInterprojectClasspathRootForBinary,
} from './interproject-paths.js';

test('interprojectBytecodeRootSuffixes includes test dirs when requested', () => {
  const m = interprojectBytecodeRootSuffixes(false);
  const t = interprojectBytecodeRootSuffixes(true);
  expect(m.length).toBeLessThan(t.length);
});

test('resolveInterprojectClasspathRootForBinary finds kotlin main output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-ipath-'));
  const classRel = 'com/example/Demo.class';
  const root = path.join(dir, 'build/classes/kotlin/main');
  fs.mkdirSync(path.dirname(path.join(root, classRel)), { recursive: true });
  fs.writeFileSync(path.join(root, classRel), 'x');

  expect(resolveInterprojectClasspathRootForBinary(dir, classRel, false)).toBe(root);
});

test('shouldTryKotlinScalaAndGroovyWhenTheRequestIsJava', () => {
  const paths = candidateInterprojectSourcePaths('/mod', 'com/acme/Foo.java', true).map((c) => c.absolutePath);
  const rels = [
    'src/main/java/com/acme/Foo.java',
    'src/main/kotlin/com/acme/Foo.kt',
    'src/main/scala/com/acme/Foo.scala',
    'src/main/groovy/com/acme/Foo.groovy',
    'src/test/java/com/acme/Foo.java',
    'src/test/kotlin/com/acme/Foo.kt',
    'src/test/scala/com/acme/Foo.scala',
    'src/test/groovy/com/acme/Foo.groovy',
  ];
  expect(paths).toEqual(rels.map((rel) => path.join('/mod', rel)));
});

test('shouldResolveMavenTargetClassesAndTargetTestClasses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-ipath-'));
  try {
    const mainClass = 'com/example/MainType.class';
    const testClass = 'com/example/TestType.class';
    const mainRoot = path.join(dir, 'target/classes');
    const testRoot = path.join(dir, 'target/test-classes');
    fs.mkdirSync(path.dirname(path.join(mainRoot, mainClass)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(testRoot, testClass)), { recursive: true });
    fs.writeFileSync(path.join(mainRoot, mainClass), 'x');
    fs.writeFileSync(path.join(testRoot, testClass), 'x');

    expect(resolveInterprojectClasspathRootForBinary(dir, mainClass, false)).toBe(mainRoot);
    expect(resolveInterprojectClasspathRootForBinary(dir, testClass, false)).toBeNull();
    expect(resolveInterprojectClasspathRootForBinary(dir, testClass, true)).toBe(testRoot);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
