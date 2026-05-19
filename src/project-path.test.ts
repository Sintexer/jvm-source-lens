import path from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { resolveProjectRoot } from './project-path.js';

const repoRoot = path.resolve(import.meta.dir, '..');
const fixtureRoot = path.join(repoRoot, 'test/fixtures/gradle-smoke');
const allowedRoot = repoRoot;

let prevAllowed: string | undefined;

afterEach(() => {
  if (prevAllowed === undefined) {
    delete process.env.JVMSRC_ALLOWED_ROOTS;
  } else {
    process.env.JVMSRC_ALLOWED_ROOTS = prevAllowed;
  }
});

test('resolveProjectRoot rejects path outside JVMSRC_ALLOWED_ROOTS', () => {
  prevAllowed = process.env.JVMSRC_ALLOWED_ROOTS;
  process.env.JVMSRC_ALLOWED_ROOTS = allowedRoot;
  const r = resolveProjectRoot('/etc');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.message).toContain('JVMSRC_ALLOWED_ROOTS');
  }
});

test('resolveProjectRoot allows nested path under JVMSRC_ALLOWED_ROOTS', () => {
  prevAllowed = process.env.JVMSRC_ALLOWED_ROOTS;
  process.env.JVMSRC_ALLOWED_ROOTS = allowedRoot;
  const r = resolveProjectRoot(fixtureRoot);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.path).toBe(fixtureRoot);
  }
});
