import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { findSourceEntriesByFileName } from './zip-entry.js';

function jarWith(entries: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-basename-'));
  const jar = path.join(dir, 'x-sources.jar');
  fs.writeFileSync(jar, zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))));
  return jar;
}

describe('findSourceEntriesByFileName', () => {
  test('shouldReturnEntriesWhoseFileNameAndPackageMatch', () => {
    const jar = jarWith({
      'commonMain/Job.kt': 'package com.x\n\ninterface Job\n',
      'commonMain/flow/Job.kt': 'package com.x.flow\n\ninterface Job\n',
      'commonMain/Other.kt': 'package com.x\n',
    });
    const r = findSourceEntriesByFileName(jar, 'Job.kt', 'com.x');
    expect(r).toEqual({ ok: true, entryRelPaths: ['commonMain/Job.kt'] });
  });

  test('shouldMatchTheDefaultPackageWhenPackageIsEmpty', () => {
    const jar = jarWith({ 'src/Lone.kt': 'class Lone\n' });
    expect(findSourceEntriesByFileName(jar, 'Lone.kt', '')).toEqual({ ok: true, entryRelPaths: ['src/Lone.kt'] });
  });

  test('shouldReturnNothingWhenNoFileHasThatName', () => {
    const jar = jarWith({ 'a/B.kt': 'package p\n' });
    expect(findSourceEntriesByFileName(jar, 'Job.kt', 'p')).toEqual({ ok: true, entryRelPaths: [] });
  });

  test('shouldPreferJvmMainOverCommonMainWhenBothDeclareThePackage', () => {
    const jar = jarWith({
      'commonMain/Dispatchers.kt': 'package com.x\n\nexpect object Dispatchers\n',
      'nativeMain/Dispatchers.kt': 'package com.x\n\nactual object Dispatchers\n',
      'jvmMain/Dispatchers.kt': 'package com.x\n\nactual object Dispatchers\n',
    });
    expect(findSourceEntriesByFileName(jar, 'Dispatchers.kt', 'com.x')).toEqual({
      ok: true,
      entryRelPaths: ['jvmMain/Dispatchers.kt', 'commonMain/Dispatchers.kt', 'nativeMain/Dispatchers.kt'],
    });
  });

  test('shouldRankNeutralPathsBetweenJvmAndCommonWhenFoldersAreUnknown', () => {
    const jar = jarWith({
      'commonMain/A.kt': 'package p\n',
      'src/A.kt': 'package p\n',
      'androidMain/A.kt': 'package p\n',
    });
    expect(findSourceEntriesByFileName(jar, 'A.kt', 'p')).toEqual({
      ok: true,
      entryRelPaths: ['androidMain/A.kt', 'src/A.kt', 'commonMain/A.kt'],
    });
  });
});
