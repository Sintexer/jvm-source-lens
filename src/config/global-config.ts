import fs from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import { writeFileAtomicSameDir } from '../cache/paths.js';

const APP_NAME = 'jvmsrc';
const CONFIG_FILE_NAME = 'config.json';
const SCHEMA_VERSION = 1;

export interface GlobalConfig {
  schemaVersion: number;
  jdkSearchRoots: string[];
}

export type GlobalConfigResult<T> =
  | { ok: true; value: T; path: string }
  | { ok: false; message: string };

function resolveGlobalConfigRoot(): { ok: true; path: string } | { ok: false; message: string } {
  const raw = process.env.JVMSRC_CONFIG_DIR?.trim();
  if (raw) {
    if (!path.isAbsolute(raw)) {
      return {
        ok: false,
        message:
          'JVMSRC_CONFIG_DIR must be set to an absolute path; relative paths are not allowed (they would depend on the process working directory).',
      };
    }
    return { ok: true, path: path.normalize(raw) };
  }
  return { ok: true, path: envPaths(APP_NAME, { suffix: '' }).config };
}

function defaultConfig(): GlobalConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    jdkSearchRoots: [],
  };
}

function normalizeAbsDir(input: string): string {
  return path.normalize(path.resolve(input.trim()));
}

function dedupeRoots(roots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const normalized = normalizeAbsDir(root);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseGlobalConfig(raw: unknown): GlobalConfig {
  if (!raw || typeof raw !== 'object') {
    return defaultConfig();
  }

  const parsed = raw as { schemaVersion?: unknown; jdkSearchRoots?: unknown };
  const roots = Array.isArray(parsed.jdkSearchRoots)
    ? parsed.jdkSearchRoots.filter((v): v is string => typeof v === 'string')
    : [];

  return {
    schemaVersion:
      typeof parsed.schemaVersion === 'number' && Number.isInteger(parsed.schemaVersion)
        ? parsed.schemaVersion
        : SCHEMA_VERSION,
    jdkSearchRoots: dedupeRoots(roots.filter((r) => path.isAbsolute(normalizeAbsDir(r)))),
  };
}

export function resolveGlobalConfigPath(): string {
  const root = resolveGlobalConfigRoot();
  if (!root.ok) {
    return path.join(envPaths(APP_NAME, { suffix: '' }).config, CONFIG_FILE_NAME);
  }
  return path.join(root.path, CONFIG_FILE_NAME);
}

export function readGlobalConfig(): GlobalConfigResult<GlobalConfig> {
  const root = resolveGlobalConfigRoot();
  if (!root.ok) {
    return root;
  }
  const filePath = path.join(root.path, CONFIG_FILE_NAME);
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { ok: true, value: defaultConfig(), path: filePath };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return { ok: true, value: parseGlobalConfig(parsed), path: filePath };
  } catch {
    return {
      ok: false,
      message: `Global config is not valid JSON: ${filePath}`,
    };
  }
}

function writeGlobalConfig(cfg: GlobalConfig, filePath: string): GlobalConfigResult<GlobalConfig> {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomicSameDir(filePath, `${JSON.stringify(cfg, null, 2)}\n`);
    return { ok: true, value: cfg, path: filePath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `Failed to write global config ${filePath}: ${msg}`,
    };
  }
}

export function readGlobalJdkSearchRootsSafe(): string[] {
  const cfg = readGlobalConfig();
  if (!cfg.ok) {
    return [];
  }
  return cfg.value.jdkSearchRoots;
}

export function addGlobalJdkSearchRoot(inputDir: string): GlobalConfigResult<{ added: boolean; root: string; roots: string[] }> {
  const root = resolveGlobalConfigRoot();
  if (!root.ok) {
    return root;
  }
  const filePath = path.join(root.path, CONFIG_FILE_NAME);
  const trimmed = inputDir.trim();
  if (!trimmed) {
    return { ok: false, message: 'JDK root path must not be empty.' };
  }
  const normalized = normalizeAbsDir(trimmed);
  if (!path.isAbsolute(normalized)) {
    return { ok: false, message: `JDK root must be an absolute path: ${inputDir}` };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch {
    return { ok: false, message: `JDK root directory does not exist: ${normalized}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, message: `JDK root path is not a directory: ${normalized}` };
  }

  const current = readGlobalConfig();
  if (!current.ok) {
    return current;
  }

  const roots = dedupeRoots([...current.value.jdkSearchRoots, normalized]);
  const added = !current.value.jdkSearchRoots.some((r) => normalizeAbsDir(r) === normalized);
  const next: GlobalConfig = {
    schemaVersion: SCHEMA_VERSION,
    jdkSearchRoots: roots,
  };
  const saved = writeGlobalConfig(next, filePath);
  if (!saved.ok) {
    return saved;
  }
  return { ok: true, value: { added, root: normalized, roots }, path: filePath };
}

export function removeGlobalJdkSearchRoot(inputDir: string): GlobalConfigResult<{ removed: boolean; root: string; roots: string[] }> {
  const root = resolveGlobalConfigRoot();
  if (!root.ok) {
    return root;
  }
  const filePath = path.join(root.path, CONFIG_FILE_NAME);
  const trimmed = inputDir.trim();
  if (!trimmed) {
    return { ok: false, message: 'JDK root path must not be empty.' };
  }
  const normalized = normalizeAbsDir(trimmed);

  const current = readGlobalConfig();
  if (!current.ok) {
    return current;
  }

  const roots = current.value.jdkSearchRoots.filter((r) => normalizeAbsDir(r) !== normalized);
  const removed = roots.length !== current.value.jdkSearchRoots.length;
  const next: GlobalConfig = {
    schemaVersion: SCHEMA_VERSION,
    jdkSearchRoots: dedupeRoots(roots),
  };
  const saved = writeGlobalConfig(next, filePath);
  if (!saved.ok) {
    return saved;
  }
  return { ok: true, value: { removed, root: normalized, roots: next.jdkSearchRoots }, path: filePath };
}
