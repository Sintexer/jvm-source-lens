import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalProjectRoot } from '../../cache/paths.js';
import { walkProjectTree } from '../../cache/walk-project-tree.js';
import type { BuildCacheInputs } from '../base.js';
import type { ResolvedArtifact } from '../resolution-output.js';

const MAVEN_EXTRA_SKIP_DIRS: ReadonlySet<string> = new Set(['target', '.mvn']);

const DOT_MVN_TRACKED_FILES = [
  '.mvn/maven.config',
  '.mvn/jvm.config',
  '.mvn/extensions.xml',
  '.mvn/wrapper/maven-wrapper.properties',
] as const;

function readRepoLocalFromMavenConfig(projectRoot: string): string | null {
  const cfgPath = path.join(projectRoot, '.mvn', 'maven.config');
  try {
    if (!fs.existsSync(cfgPath)) {
      return null;
    }
    const raw = fs.readFileSync(cfgPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const m = trimmed.match(/-Dmaven\.repo\.local=(?:"([^"]+)"|'([^']+)'|(\S+))/);
      if (m) {
        const val = (m[1] ?? m[2] ?? m[3] ?? '').trim();
        if (val.length > 0) {
          return path.resolve(projectRoot, val);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readRepoLocalFromSettingsXml(homeDir: string): string | null {
  const settingsPath = path.join(homeDir, '.m2', 'settings.xml');
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const xml = fs.readFileSync(settingsPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const m = xml.match(/<localRepository>\s*([^<]+?)\s*<\/localRepository>/i);
    if (!m || !m[1]) {
      return null;
    }
    const expanded = m[1]
      .trim()
      .replace(/\$\{user\.home\}/g, homeDir)
      .replace(/^~(?=$|[\\/])/, homeDir);
    return path.resolve(expanded);
  } catch {
    return null;
  }
}

/**
 * Effective Maven local repository directory for `projectRoot`:
 * `.mvn/maven.config` `-Dmaven.repo.local=...` -> `~/.m2/settings.xml` `<localRepository>` -> `~/.m2/repository`.
 */
export function resolveMavenLocalRepository(
  projectRoot: string,
  homeDir: string = os.homedir(),
): string {
  return (
    readRepoLocalFromMavenConfig(projectRoot) ??
    readRepoLocalFromSettingsXml(homeDir) ??
    path.join(homeDir, '.m2', 'repository')
  );
}

/** SHA-256 hex of a file (or `'absent'`). Never exposes raw XML or credentials. */
function fileDigestOrAbsent(filePath: string): string {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return 'absent';
    }
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return 'absent';
  }
}

/**
 * SHA-256 hex of `~/.m2/settings.xml` (or `'absent'`). Never exposes raw XML or credentials.
 */
export function settingsXmlDigestOrAbsent(homeDir: string = os.homedir()): string {
  return fileDigestOrAbsent(path.join(homeDir, '.m2', 'settings.xml'));
}

function readPomText(pomPath: string): string | null {
  try {
    return fs.readFileSync(pomPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  } catch {
    return null;
  }
}

/** Absolute paths of the `<module>` entries of the pom in `dir` (a module may name a pom file). */
function moduleTargets(dir: string): string[] {
  const xml = readPomText(path.join(dir, 'pom.xml'));
  if (xml === null) {
    return [];
  }
  const targets: string[] = [];
  for (const m of xml.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)) {
    const abs = path.resolve(dir, m[1]!);
    targets.push(abs.endsWith('.xml') ? path.dirname(abs) : abs);
  }
  return targets;
}

/** The parent pom file named by `<parent><relativePath>` (default `../pom.xml`), if it exists. */
function parentPomFile(pomPath: string): string | null {
  const xml = readPomText(pomPath);
  const parent = xml?.match(/<parent>([\s\S]*?)<\/parent>/);
  if (!parent) {
    return null;
  }
  const rel = parent[1]!.match(/<relativePath\s*>([\s\S]*?)<\/relativePath>|<relativePath\s*\/>/);
  const value = rel === null ? '../pom.xml' : (rel[1] ?? '').trim();
  if (value.length === 0) {
    return null;
  }
  let target = path.resolve(path.dirname(pomPath), value);
  try {
    if (fs.statSync(target).isDirectory()) {
      target = path.join(target, 'pom.xml');
    }
    return fs.statSync(target).isFile() ? fs.realpathSync(target) : null;
  } catch {
    return null;
  }
}

/** Parent poms (and their parents) that lie outside `rootAbs`, as sorted `[path, sha256]` pairs. */
function outOfTreeParentPomDigests(rootAbs: string, poms: readonly string[]): [string, string][] {
  const seen = new Set<string>();
  const found: [string, string][] = [];
  let realRoot = rootAbs;
  try {
    realRoot = fs.realpathSync(rootAbs);
  } catch {
    /* keep the given root */
  }
  const isOutside = (p: string): boolean => {
    const rel = path.relative(realRoot, p);
    return rel.startsWith('..') || path.isAbsolute(rel);
  };
  const visit = (pomPath: string): void => {
    const parent = parentPomFile(pomPath);
    if (parent === null || seen.has(parent)) {
      return;
    }
    if (!isOutside(parent)) {
      return;
    }
    seen.add(parent);
    found.push([`M2_PARENT_POM_SHA256:${parent}`, fileDigestOrAbsent(parent)]);
    visit(parent);
  };
  for (const rel of poms) {
    visit(path.join(rootAbs, ...rel.split('/')));
  }
  return found.sort((a, b) => a[0].localeCompare(b[0]));
}

/** `-s` / `--settings[=]` and `-gs` / `--global-settings[=]` files from `.mvn/maven.config`. */
function settingsFilesFromMavenConfig(projectRoot: string): { user: string[]; global: string[] } {
  const out = { user: [] as string[], global: [] as string[] };
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(projectRoot, '.mvn', 'maven.config'), 'utf8');
  } catch {
    return out;
  }
  const text = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join(' ');
  const unquote = (t: string): string => t.replace(/^(["'])(.*)\1$/, '$2');
  const tokens = (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const eq = t.match(/^(--settings|--global-settings)=(.+)$/);
    let kind: 'user' | 'global' | null = null;
    let value: string | undefined;
    if (eq) {
      kind = eq[1] === '--settings' ? 'user' : 'global';
      value = eq[2];
    } else if (t === '-s' || t === '--settings') {
      kind = 'user';
      value = tokens[++i];
    } else if (t === '-gs' || t === '--global-settings') {
      kind = 'global';
      value = tokens[++i];
    }
    if (kind !== null && value) {
      out[kind].push(path.resolve(projectRoot, value));
    }
  }
  return out;
}

/**
 * True when `dir` (named like a skipped build directory) holds a reactor module: the pom in its
 * parent directory lists `dir`, or a module below it, in `<modules>`.
 */
function holdsDeclaredModule(dir: string): boolean {
  const prefix = dir + path.sep;
  return moduleTargets(path.dirname(dir)).some((m) => m === dir || m.startsWith(prefix));
}

/** Sorted POSIX relative paths of Maven build inputs under `projectRoot`. */
export function listMavenBuildInputRelativePaths(projectRoot: string): string[] {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const files = walkProjectTree(rootAbs, {
    extraSkipDirs: MAVEN_EXTRA_SKIP_DIRS,
    shouldDescend: (_name, absolutePath) => holdsDeclaredModule(absolutePath),
    includeFile: (name) => name === 'pom.xml',
  });

  for (const rel of DOT_MVN_TRACKED_FILES) {
    const full = path.join(rootAbs, ...rel.split('/'));
    try {
      if (fs.existsSync(full) && !fs.lstatSync(full).isSymbolicLink() && fs.statSync(full).isFile()) {
        files.push(rel);
      }
    } catch {
      /* ignore unreadable */
    }
  }

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

/**
 * Digest inputs of the Maven build. Optional inputs (out-of-tree parent poms, `-s`/`-gs` files,
 * Maven home settings, user `extensions.xml`) are added only when they exist, so a project that
 * has none keeps its previous digest.
 */
export function mavenCacheInputs(
  projectRoot: string,
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): BuildCacheInputs {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const files = listMavenBuildInputRelativePaths(projectRoot);
  const envEntries: [string, string][] = [
    ['M2_LOCAL_REPO', resolveMavenLocalRepository(projectRoot, homeDir)],
    ['M2_SETTINGS_SHA256', settingsXmlDigestOrAbsent(homeDir)],
  ];
  const optional = (key: string, file: string): void => {
    const digest = fileDigestOrAbsent(file);
    if (digest !== 'absent') {
      envEntries.push([key, digest]);
    }
  };

  envEntries.push(...outOfTreeParentPomDigests(rootAbs, files.filter((f) => f.endsWith('pom.xml'))));
  const mavenHome = env.M2_HOME ?? env.MAVEN_HOME;
  if (mavenHome) {
    optional('M2_GLOBAL_SETTINGS_SHA256', path.join(mavenHome, 'conf', 'settings.xml'));
  }
  optional('M2_EXTENSIONS_SHA256', path.join(homeDir, '.m2', 'extensions.xml'));
  const configured = settingsFilesFromMavenConfig(rootAbs);
  for (const f of configured.user) {
    optional(`M2_SETTINGS_FILE_SHA256`, f);
  }
  for (const f of configured.global) {
    optional(`M2_GLOBAL_SETTINGS_FILE_SHA256`, f);
  }
  return { files, env: envEntries };
}

/**
 * Returns `true` only for non-SNAPSHOT release JARs stored inside the local Maven repository.
 * `-SNAPSHOT` artifacts in `~/.m2/repository` can be overwritten by `mvn install` without any
 * `pom.xml` edit, so they must remain mutable (`false`) and participate in `local-artifact.hash`.
 */
export function isMavenImmutableArtifact(
  artifact: ResolvedArtifact,
  localRepository: string = path.join(os.homedir(), '.m2', 'repository'),
): boolean {
  if (!artifact.jarPath || !artifact.version) {
    return false;
  }
  if (artifact.version.toUpperCase().endsWith('-SNAPSHOT')) {
    return false;
  }
  const normalizedJar = path.resolve(artifact.jarPath);
  const repoAbs = path.resolve(localRepository);
  const prefix = repoAbs.endsWith(path.sep) ? repoAbs : repoAbs + path.sep;
  return normalizedJar.startsWith(prefix);
}
