import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
});
