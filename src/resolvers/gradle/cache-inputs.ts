import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalProjectRoot } from '../../cache/paths.js';
import { walkProjectTree } from '../../cache/walk-project-tree.js';
import type { BuildCacheInputs } from '../base.js';

const GRADLE_EXTRA_SKIP_DIRS: ReadonlySet<string> = new Set(['.gradle']);

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

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

export function gradleCacheInputs(projectRoot: string): BuildCacheInputs {
  return {
    files: listGradleBuildInputRelativePaths(projectRoot),
    env: [['GRADLE_USER_HOME', gradleUserHome()]],
  };
}
