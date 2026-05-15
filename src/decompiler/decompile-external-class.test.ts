import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decompileExternalClass } from './decompile-external-class.js';

let prevJvmsrcCacheRoot: string | undefined;
let testCacheRoot: string;

function isolateCacheEnv(): void {
  testCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-decompile-'));
  prevJvmsrcCacheRoot = process.env.JVMSRC_CACHE_ROOT;
  process.env.JVMSRC_CACHE_ROOT = testCacheRoot;
}

function restoreCacheEnv(): void {
  if (prevJvmsrcCacheRoot === undefined) {
    delete process.env.JVMSRC_CACHE_ROOT;
  } else {
    process.env.JVMSRC_CACHE_ROOT = prevJvmsrcCacheRoot;
  }
  try {
    fs.rmSync(testCacheRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const baseOpts = {
  className: 'com.example.Foo',
  jarPath: '/tmp/lib.jar',
  entryRelPath: 'com/example/Foo.class',
  coordinates: { group: 'com.example', name: 'lib', version: '1.0' as string | null },
};

describe('decompileExternalClass', () => {
  test('returns cached source without calling CFR', async () => {
    isolateCacheEnv();
    try {
      const r1 = await decompileExternalClass({
        ...baseOpts,
        runCfr: async () => ({ ok: true, source: 'from cfr' }),
      });
      expect(r1.ok).toBe(true);
      if (!r1.ok) {
        return;
      }

      let cfrCalls = 0;
      const r2 = await decompileExternalClass({
        ...baseOpts,
        runCfr: async () => {
          cfrCalls += 1;
          return { ok: true, source: 'should not run' };
        },
      });
      expect(cfrCalls).toBe(0);
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        expect(r2.source).toBe('from cfr');
        expect(r2.sourceAvailable).toBe(false);
        expect(r2.provenance.kind).toBe('decompiled');
        expect(r2.provenance.cachePath).toBe(r1.provenance.cachePath);
      }
    } finally {
      restoreCacheEnv();
    }
  });

  test('calls CFR on cache miss and writes cache', async () => {
    isolateCacheEnv();
    try {
      const r = await decompileExternalClass({
        ...baseOpts,
        coordinates: { group: 'g2', name: 'a2', version: '2' },
        runCfr: async () => ({ ok: true, source: 'decompiled\n' }),
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.source).toBe('decompiled\n');
        expect(fs.existsSync(r.provenance.cachePath)).toBe(true);
      }
    } finally {
      restoreCacheEnv();
    }
  });

  test('returns DECOMPILE_FAILED when CFR fails', async () => {
    isolateCacheEnv();
    try {
      const r = await decompileExternalClass({
        ...baseOpts,
        coordinates: { group: 'g3', name: 'a3', version: '3' },
        runCfr: async () => ({ ok: false, message: 'CFR blew up', stderr: 'err' }),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('DECOMPILE_FAILED');
        expect(r.error.stderr).toBe('err');
      }
    } finally {
      restoreCacheEnv();
    }
  });
});
