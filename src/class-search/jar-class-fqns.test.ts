import { describe, expect, test } from 'bun:test';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';
import { listFqnsFromJarClassEntries } from './jar-class-fqns.js';

describe('jar-class-fqns', () => {
  test('lists FQNs from .class entries via central directory only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jvmsrc-jar-test-'));
    const jarPath = join(dir, 'sample.jar');
    try {
      const bytes = zipSync({
        'com/smoke/Demo.class': new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
        'META-INF/MANIFEST.MF': new Uint8Array([0]),
      });
      writeFileSync(jarPath, bytes);

      const r = listFqnsFromJarClassEntries(jarPath);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.fqns).toContain('com.smoke.Demo');
        expect(r.fqns.some((f) => f.includes('MANIFEST'))).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
