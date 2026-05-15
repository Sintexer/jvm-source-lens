import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
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
