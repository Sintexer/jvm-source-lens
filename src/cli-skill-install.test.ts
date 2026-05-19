import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getBundledSkillSourcePath,
  installJvmsrcSkill,
  parseSkillAgent,
  resolveSkillDest,
  resolveSkillInstallDestinations,
} from './cli-skill-install.js';

describe('cli-skill-install', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function mkTmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-skill-'));
    tmpDirs.push(d);
    return d;
  }

  test('bundled SKILL.md exists in repo', () => {
    const source = getBundledSkillSourcePath();
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.readFileSync(source, 'utf8')).toContain('jvmsrc');
  });

  test('parseSkillAgent accepts cursor and claude', () => {
    expect(parseSkillAgent('cursor')).toBe('cursor');
    expect(parseSkillAgent('Claude')).toBe('claude');
    const unknown = parseSkillAgent('windsurf');
    expect(typeof unknown).toBe('object');
    if (typeof unknown === 'string') {
      throw new Error('expected error result');
    }
    expect(unknown.ok).toBe(false);
  });

  test('resolveSkillDest for cursor and claude user scope', () => {
    const cursor = resolveSkillDest('cursor', 'user', '/tmp/proj');
    const claude = resolveSkillDest('claude', 'user', '/tmp/proj');
    expect(cursor).toContain(path.join('.cursor', 'skills', 'jvmsrc'));
    expect(claude).toContain(path.join('.claude', 'skills', 'jvmsrc'));
  });

  test('resolveSkillDest for cursor project scope', () => {
    const dest = resolveSkillDest('cursor', 'project', '/tmp/my-repo');
    expect(dest).toBe(path.join('/tmp/my-repo', '.cursor', 'skills', 'jvmsrc', 'SKILL.md'));
  });

  test('claude project scope is rejected', () => {
    expect(() => resolveSkillDest('claude', 'project', '/tmp')).toThrow();
  });

  test('install to custom dir', () => {
    const parent = mkTmp();
    const r = installJvmsrcSkill({
      agent: 'cursor',
      scope: 'user',
      projectRoot: parent,
      destDir: parent,
      overwrite: true, // --force required for paths outside home directory
      dryRun: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dest = path.join(parent, 'jvmsrc', 'SKILL.md');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe(fs.readFileSync(getBundledSkillSourcePath(), 'utf8'));
  });

  test('refuses overwrite without force', () => {
    const parent = mkTmp();
    const first = installJvmsrcSkill({
      agent: 'cursor',
      scope: 'user',
      projectRoot: parent,
      destDir: parent,
      overwrite: true, // --force required for paths outside home directory
      dryRun: false,
    });
    expect(first.ok).toBe(true);
    const second = installJvmsrcSkill({
      agent: 'cursor',
      scope: 'user',
      projectRoot: parent,
      destDir: parent,
      overwrite: false,
      dryRun: false,
    });
    expect(second.ok).toBe(false);
  });

  test('resolveSkillInstallDestinations returns single entry', () => {
    const r = resolveSkillInstallDestinations({
      agent: 'claude',
      scope: 'user',
      projectRoot: '/tmp/proj',
      overwrite: false,
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.agent).toBe('claude');
  });
});
