import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalProjectRoot } from '../../cache/paths.js';
import { walkProjectTree } from '../../cache/walk-project-tree.js';
import type { BuildCacheInputs } from '../base.js';

const GRADLE_EXTRA_SKIP_DIRS: ReadonlySet<string> = new Set(['.gradle']);

/** Build-logic directories whose sources change the resolved classpath (SPEC §6.1). */
const BUILD_LOGIC_DIRS = ['buildSrc', 'build-logic'] as const;

const BUILD_LOGIC_EXTENSIONS: ReadonlySet<string> = new Set([
  '.java',
  '.kt',
  '.kts',
  '.groovy',
  '.gradle',
  '.properties',
  '.toml',
  '.lockfile',
]);

/** Guards against runaway chains of included builds. */
const MAX_INCLUDED_BUILD_DEPTH = 8;

const INCLUDE_BUILD_PATTERN = /\bincludeBuild\s*\(?\s*(?:file\s*\(\s*)?["']([^"']+)["']/g;

function isBuildLogicFile(name: string): boolean {
  return BUILD_LOGIC_EXTENSIONS.has(path.extname(name));
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Directories named by `includeBuild(...)` in the `settings.gradle[.kts]` of `buildDir`. */
function readIncludedBuildDirs(buildDir: string): string[] {
  const dirs: string[] = [];
  for (const name of ['settings.gradle', 'settings.gradle.kts']) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(buildDir, name), 'utf8');
    } catch {
      continue;
    }
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(INCLUDE_BUILD_PATTERN)) {
      dirs.push(path.resolve(buildDir, m[1]!));
    }
  }
  return dirs;
}

function toRelativePosix(rootAbs: string, abs: string): string {
  return path.relative(rootAbs, abs).split(path.sep).join('/');
}

/** Sources of `buildSrc`, `build-logic` and every (nested) included build, relative to `rootAbs`. */
function listBuildLogicInputs(rootAbs: string): string[] {
  const files: string[] = [];
  const visited = new Set<string>([rootAbs]);

  const addTree = (dirAbs: string): void => {
    for (const rel of walkProjectTree(dirAbs, {
      extraSkipDirs: GRADLE_EXTRA_SKIP_DIRS,
      includeFile: (name) => isBuildLogicFile(name),
    })) {
      files.push(toRelativePosix(rootAbs, path.join(dirAbs, rel)));
    }
  };

  const visit = (buildDir: string, depth: number): void => {
    for (const name of BUILD_LOGIC_DIRS) {
      const dir = path.join(buildDir, name);
      if (isDirectory(dir)) {
        addTree(dir);
      }
    }
    if (depth >= MAX_INCLUDED_BUILD_DEPTH) {
      return;
    }
    for (const included of readIncludedBuildDirs(buildDir)) {
      const real = isDirectory(included) ? fs.realpathSync(included) : null;
      // A build that contains the root would pull in the whole tree; skip it.
      if (!real || visited.has(real) || rootAbs.startsWith(real + path.sep)) {
        continue;
      }
      visited.add(real);
      addTree(real);
      visit(real, depth + 1);
    }
  };

  visit(rootAbs, 0);
  return files;
}

/**
 * Returns the Gradle user home directory — the root of Gradle's managed artifact cache.
 * Respects `GRADLE_USER_HOME`; falls back to `~/.gradle`.
 */
export function gradleUserHome(): string {
  const env = process.env.GRADLE_USER_HOME?.trim();
  return env ? path.resolve(env) : path.join(os.homedir(), '.gradle');
}

/**
 * Returns `true` when `jarPath` lives inside Gradle's managed artifact cache
 * (`GRADLE_USER_HOME/`). Those JARs are immutable once downloaded and do not
 * need per-file content hashing in the local-artifact digest.
 */
export function isGradleManagedJar(jarPath: string): boolean {
  const gradleHome = gradleUserHome();
  const normalized = path.resolve(jarPath);
  const prefix = gradleHome.endsWith(path.sep) ? gradleHome : gradleHome + path.sep;
  return normalized.startsWith(prefix);
}

/** Relative paths of Gradle build inputs (SPEC §6.1), sorted, POSIX-style separators. */
export function listGradleBuildInputRelativePaths(projectRoot: string): string[] {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const files: string[] = [];

  for (const name of ['settings.gradle', 'settings.gradle.kts']) {
    if (fs.existsSync(path.join(rootAbs, name))) {
      files.push(name);
    }
  }

  const walked = walkProjectTree(rootAbs, {
    extraSkipDirs: GRADLE_EXTRA_SKIP_DIRS,
    includeFile: (name) =>
      name === 'build.gradle' || name === 'build.gradle.kts' || name === 'gradle.properties',
  });
  files.push(...walked);

  const toml = path.join(rootAbs, 'gradle', 'libs.versions.toml');
  if (fs.existsSync(toml) && fs.statSync(toml).isFile()) {
    files.push('gradle/libs.versions.toml');
  }

  const wrapperProps = path.join(rootAbs, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (fs.existsSync(wrapperProps) && fs.statSync(wrapperProps).isFile()) {
    files.push('gradle/wrapper/gradle-wrapper.properties');
  }

  const lockDir = path.join(rootAbs, 'gradle', 'dependency-locks');
  if (fs.existsSync(lockDir) && fs.statSync(lockDir).isDirectory()) {
    for (const n of fs.readdirSync(lockDir).sort()) {
      if (n.endsWith('.lockfile')) {
        files.push(`gradle/dependency-locks/${n}`);
      }
    }
  }

  files.push(...listBuildLogicInputs(rootAbs));

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

export function gradleCacheInputs(projectRoot: string): BuildCacheInputs {
  return {
    files: listGradleBuildInputRelativePaths(projectRoot),
    env: [['GRADLE_USER_HOME', gradleUserHome()]],
  };
}
