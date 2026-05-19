import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACKAGE_ROOT } from './cli-config-command.js';

export const SKILL_DIR_NAME = 'jvmsrc';
export const SKILL_FILENAME = 'SKILL.md';

export const SKILL_AGENTS = ['cursor', 'claude'] as const;
export type SkillAgent = (typeof SKILL_AGENTS)[number];

export const SKILL_INSTALL_SCOPES = ['user', 'project'] as const;
export type SkillInstallScope = (typeof SKILL_INSTALL_SCOPES)[number];

export type SkillInstallOptions = {
  agent: SkillAgent;
  scope: SkillInstallScope;
  projectRoot: string;
  /** Explicit destination parent; installs to `<dir>/jvmsrc/SKILL.md`. */
  destDir?: string;
  overwrite: boolean;
  dryRun: boolean;
};

export type SkillInstallEntry = {
  agent: SkillAgent | 'custom';
  scope: SkillInstallScope | 'custom';
  path: string;
};

export type SkillInstallResult =
  | { ok: true; source: string; entries: SkillInstallEntry[] }
  | { ok: false; message: string };

/** Absolute path to SKILL.md shipped with this jvmsrc package. */
export function getBundledSkillSourcePath(): string {
  return path.join(PACKAGE_ROOT, SKILL_FILENAME);
}

export function parseSkillAgent(raw: string): SkillAgent | { ok: false; message: string } {
  const normalized = raw.trim().toLowerCase();
  if ((SKILL_AGENTS as readonly string[]).includes(normalized)) {
    return normalized as SkillAgent;
  }
  return {
    ok: false,
    message: `Unknown agent ${JSON.stringify(raw)}. Use: ${SKILL_AGENTS.join(', ')}`,
  };
}

export function parseSkillInstallScope(raw: string): SkillInstallScope | { ok: false; message: string } {
  const normalized = raw.trim().toLowerCase();
  if ((SKILL_INSTALL_SCOPES as readonly string[]).includes(normalized)) {
    return normalized as SkillInstallScope;
  }
  return {
    ok: false,
    message: `Unknown scope ${JSON.stringify(raw)}. Use: ${SKILL_INSTALL_SCOPES.join(', ')}`,
  };
}

function bundledSkillPath(): SkillInstallResult | { ok: true; source: string } {
  const source = getBundledSkillSourcePath();
  if (!fs.existsSync(source)) {
    return {
      ok: false,
      message:
        `Bundled ${SKILL_FILENAME} not found at ${source}. Reinstall jvmsrc or run from a built package.`,
    };
  }
  const stat = fs.statSync(source);
  if (!stat.isFile()) {
    return { ok: false, message: `${source} is not a file` };
  }
  return { ok: true, source };
}

export function resolveSkillDest(agent: SkillAgent, scope: SkillInstallScope, projectRoot: string): string {
  if (agent === 'claude' && scope === 'project') {
    throw new Error('Project-scoped skills are only supported for --agent cursor (use --scope user for Claude Code).');
  }
  const home = os.homedir();
  if (agent === 'claude') {
    return path.join(home, '.claude', 'skills', SKILL_DIR_NAME, SKILL_FILENAME);
  }
  if (scope === 'project') {
    return path.join(path.resolve(projectRoot), '.cursor', 'skills', SKILL_DIR_NAME, SKILL_FILENAME);
  }
  return path.join(home, '.cursor', 'skills', SKILL_DIR_NAME, SKILL_FILENAME);
}

function installOne(
  source: string,
  dest: string,
  overwrite: boolean,
  dryRun: boolean,
): SkillInstallResult | { ok: true } {
  if (!overwrite && !dryRun && fs.existsSync(dest)) {
    return {
      ok: false,
      message: `Already exists (use --force): ${dest}`,
    };
  }
  const destDir = path.dirname(dest);
  if (!dryRun) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(source, dest);
  }
  return { ok: true };
}

export function resolveSkillInstallDestinations(opts: SkillInstallOptions): SkillInstallResult {
  const bundled = bundledSkillPath();
  if (!bundled.ok) {
    return bundled;
  }

  if (opts.destDir !== undefined && opts.destDir.trim().length > 0) {
    const resolvedDir = path.resolve(opts.destDir.trim());
    const home = os.homedir();
    const underHome = resolvedDir === home || resolvedDir.startsWith(home + path.sep);
    if (!underHome && !opts.overwrite) {
      return {
        ok: false,
        message:
          `--dir resolves outside your home directory (${resolvedDir}). ` +
          `Use --force to allow writing to this location.`,
      };
    }
    const dest = path.join(resolvedDir, SKILL_DIR_NAME, SKILL_FILENAME);
    return {
      ok: true,
      source: bundled.source,
      entries: [{ agent: 'custom', scope: 'custom', path: dest }],
    };
  }

  let dest: string;
  try {
    dest = resolveSkillDest(opts.agent, opts.scope, opts.projectRoot);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }

  return {
    ok: true,
    source: bundled.source,
    entries: [{ agent: opts.agent, scope: opts.scope, path: dest }],
  };
}

export function installJvmsrcSkill(opts: SkillInstallOptions): SkillInstallResult {
  const planned = resolveSkillInstallDestinations(opts);
  if (!planned.ok) {
    return planned;
  }

  const installed: SkillInstallEntry[] = [];
  for (const entry of planned.entries) {
    const r = installOne(planned.source, entry.path, opts.overwrite, opts.dryRun);
    if (!r.ok) {
      return r;
    }
    installed.push(entry);
  }

  return { ok: true, source: planned.source, entries: installed };
}
