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

/**
 * SHA-256 hex of `~/.m2/settings.xml` (or `'absent'`). Never exposes raw XML or credentials.
 */
export function settingsXmlDigestOrAbsent(homeDir: string = os.homedir()): string {
  const settingsPath = path.join(homeDir, '.m2', 'settings.xml');
  try {
    if (!fs.existsSync(settingsPath) || !fs.statSync(settingsPath).isFile()) {
      return 'absent';
    }
    const buf = fs.readFileSync(settingsPath);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return 'absent';
  }
}

/** Sorted POSIX relative paths of Maven build inputs under `projectRoot`. */
export function listMavenBuildInputRelativePaths(projectRoot: string): string[] {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const files = walkProjectTree(rootAbs, {
    extraSkipDirs: MAVEN_EXTRA_SKIP_DIRS,
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

export function mavenCacheInputs(
  projectRoot: string,
  homeDir: string = os.homedir(),
): BuildCacheInputs {
  return {
    files: listMavenBuildInputRelativePaths(projectRoot),
    env: [
      ['M2_LOCAL_REPO', resolveMavenLocalRepository(projectRoot, homeDir)],
      ['M2_SETTINGS_SHA256', settingsXmlDigestOrAbsent(homeDir)],
    ],
  };
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
