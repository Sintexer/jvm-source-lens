import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';

/**
 * Regression: the published CLI runs on Node, where `Bun` is undefined
 * ("Failed to start Gradle: Bun is not defined"). Only `spawn-child.ts` may touch `Bun.*`,
 * and it must guard with `isBunSpawnAvailable()`.
 */
const SRC = path.dirname(new URL(import.meta.url).pathname);
const ALLOWED = new Set(['spawn-child.ts']);

function* sourceFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* sourceFiles(p);
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
      yield p;
    }
  }
}

test('shouldNotReferenceBunGlobalOutsideGuardedSpawnWrapper', () => {
  const offenders = [...sourceFiles(SRC)]
    .filter((f) => !ALLOWED.has(path.basename(f)))
    .filter((f) => /\bBun\.\w+/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f));
  expect(offenders).toEqual([]);
});

test('shouldGuardBunSpawnWithAvailabilityCheck', () => {
  const code = readFileSync(path.join(SRC, 'spawn-child.ts'), 'utf8');
  expect(code).toContain('isBunSpawnAvailable()');
});
