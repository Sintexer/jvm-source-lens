import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { findGradleRoot, resolveProjectRoot } from './project-path.js';

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

describe('project root discovery', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-root-')));
  const project = path.join(tmp, 'proj');
  const sub = path.join(project, 'app', 'src');
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(plain, { recursive: true });
  fs.writeFileSync(path.join(project, 'settings.gradle.kts'), '');

  const prevCwd = process.cwd();
  const prevEnv = process.env.JVMSRC_PROJECT_ROOT;
  afterEach(() => {
    process.chdir(prevCwd);
    if (prevEnv === undefined) delete process.env.JVMSRC_PROJECT_ROOT;
    else process.env.JVMSRC_PROJECT_ROOT = prevEnv;
  });

  test('findGradleRoot walks up to settings.gradle(.kts)', () => {
    expect(findGradleRoot(sub)).toBe(project);
    expect(findGradleRoot(plain)).not.toBe(plain);
  });

  test('subdirectory argument is lifted to the Gradle root', () => {
    const r = resolveProjectRoot(sub);
    expect(r.ok && r.path).toBe(project);
  });

  test('omitted input prefers workspace roots, then env, then cwd', () => {
    process.chdir(plain);
    delete process.env.JVMSRC_PROJECT_ROOT;
    expect(resolveProjectRoot(undefined, { workspaceRoots: [sub] })).toMatchObject({
      ok: true,
      path: project,
      source: 'workspace-root',
    });
    process.env.JVMSRC_PROJECT_ROOT = project;
    expect(resolveProjectRoot(undefined)).toMatchObject({ ok: true, path: project, source: 'env' });
    delete process.env.JVMSRC_PROJECT_ROOT;
    process.chdir(sub);
    expect(resolveProjectRoot(undefined)).toMatchObject({ ok: true, path: project, source: 'cwd' });
  });

  test('relative argument resolves against workspace roots', () => {
    const r = resolveProjectRoot('proj', { workspaceRoots: [tmp] });
    expect(r.ok && r.path).toBe(project);
  });

  test('failure message gives the next call', () => {
    process.chdir(plain);
    delete process.env.JVMSRC_PROJECT_ROOT;
    const none = resolveProjectRoot(undefined, { workspaceRoots: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toContain('Retry with projectRoot');

    const missing = resolveProjectRoot(path.join(tmp, 'missing'), { workspaceRoots: [sub] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain(`retry with projectRoot=${JSON.stringify(project)}`);
  });
});
