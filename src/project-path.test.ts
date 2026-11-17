import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { findBuildRoot, resolveProjectRoot } from './project-path.js';
import type { DependencyResolver } from './resolvers/base.js';
import { findGradleRoot } from './resolvers/gradle/index.js';
import { registerResolverForTesting } from './resolvers/index.js';

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
  const workspaceProject = path.join(tmp, 'workspace-proj');
  const envProject = path.join(tmp, 'env-proj');
  for (const p of [workspaceProject, envProject]) {
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'settings.gradle'), '');
  }

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
    expect(r.ok && r.note).toBe(`projectRoot ${sub} is inside the Gradle project at ${project}; using that.`);
  });

  test('omitted input prefers workspace roots, then env, then cwd', () => {
    process.chdir(sub);
    process.env.JVMSRC_PROJECT_ROOT = envProject;
    expect(resolveProjectRoot(undefined, { workspaceRoots: [workspaceProject] })).toMatchObject({
      ok: true,
      path: workspaceProject,
    });
    expect(resolveProjectRoot(undefined)).toMatchObject({ ok: true, path: envProject });
    delete process.env.JVMSRC_PROJECT_ROOT;
    expect(resolveProjectRoot(undefined)).toMatchObject({ ok: true, path: project });
  });

  test('relative argument resolves against workspace roots', () => {
    const r = resolveProjectRoot('proj', { workspaceRoots: [tmp] });
    expect(r.ok && r.path).toBe(project);
  });

  test('failure message gives the next call', () => {
    process.chdir(plain);
    delete process.env.JVMSRC_PROJECT_ROOT;
    const none = resolveProjectRoot(undefined, { workspaceRoots: [] });
    expect(none).toEqual({
      ok: false,
      message:
        `No Gradle project found in the workspace (looked in: ${plain}). ` +
        'Retry with projectRoot set to the absolute path of the directory containing gradlew or settings.gradle(.kts).',
    });

    const missingPath = path.join(tmp, 'missing');
    const missing = resolveProjectRoot(missingPath, { workspaceRoots: [sub] });
    expect(missing).toEqual({
      ok: false,
      message:
        `Project path does not exist: ${missingPath}.` +
        ` A Gradle project was found at ${project}; retry with projectRoot=${JSON.stringify(project)} or omit projectRoot.`,
    });

    const missingNoHint = resolveProjectRoot(missingPath, { workspaceRoots: [] });
    expect(missingNoHint).toEqual({
      ok: false,
      message:
        `Project path does not exist: ${missingPath}.` +
        ' Pass the absolute path of the directory containing gradlew or settings.gradle(.kts).',
    });

    const filePath = path.join(project, 'settings.gradle.kts');
    const notDir = resolveProjectRoot(filePath, { workspaceRoots: [] });
    expect(notDir).toEqual({
      ok: false,
      message:
        `Project path is not a directory: ${filePath}.` +
        ' Pass the absolute path of the directory containing gradlew or settings.gradle(.kts).',
    });
  });

  test('lifts subdirectory and names custom resolver via registry findBuildRoot', () => {
    const fakeProj = path.join(tmp, 'fake-proj');
    const fakeSub = path.join(fakeProj, 'mod', 'src');
    fs.mkdirSync(fakeSub, { recursive: true });
    fs.writeFileSync(path.join(fakeProj, 'custom.marker'), '');

    const fake: DependencyResolver = {
      id: 'custom',
      displayName: 'CustomTool',
      rootHint: 'custom.marker',
      detect: (root) => fs.existsSync(path.join(root, 'custom.marker')),
      findBuildRoot: (start) => {
        let dir = start;
        for (;;) {
          if (fs.existsSync(path.join(dir, 'custom.marker'))) {
            return dir;
          }
          const parent = path.dirname(dir);
          if (parent === dir) {
            return null;
          }
          dir = parent;
        }
      },
      cacheInputs: () => ({ files: [], env: [] }),
      isImmutableArtifact: () => false,
      resolve: async () => ({ ok: false, message: 'unused' }),
      resolveSourcesJar: async () => ({ ok: true, sourcesJarPath: null }),
    };

    const restore = registerResolverForTesting(fake);
    try {
      expect(findBuildRoot(fakeSub)).toBe(fakeProj);
      const lifted = resolveProjectRoot(fakeSub);
      expect(lifted).toEqual({
        ok: true,
        path: fakeProj,
        note: `projectRoot ${fakeSub} is inside the CustomTool project at ${fakeProj}; using that.`,
      });
    } finally {
      restore();
    }
  });
});
