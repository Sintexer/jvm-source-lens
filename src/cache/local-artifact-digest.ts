import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';

/**
 * Returns the Gradle user home directory — the root of Gradle's managed artifact cache.
 * Respects the `GRADLE_USER_HOME` env var; falls back to `~/.gradle`.
 */
export function gradleUserHome(): string {
  const env = process.env.GRADLE_USER_HOME?.trim();
  return env ? path.resolve(env) : path.join(os.homedir(), '.gradle');
}

/**
 * Returns `true` when the given `jarPath` lives inside Gradle's managed artifact cache
 * (`GRADLE_USER_HOME/caches/` or the broader `GRADLE_USER_HOME/` tree).
 * Such JARs are managed exclusively by Gradle and their content is immutable once downloaded,
 * so they do not need to participate in the local-artifact digest.
 */
export function isGradleManagedJar(jarPath: string): boolean {
  const gradleHome = gradleUserHome();
  const normalized = path.resolve(jarPath);
  // Ensure the comparison uses a trailing sep so we don't match a sibling dir that starts the same way.
  const prefix = gradleHome.endsWith(path.sep) ? gradleHome : gradleHome + path.sep;
  return normalized.startsWith(prefix);
}

/**
 * Collects JAR paths from `output` that are:
 *  - `origin: 'external'`  (not interproject, not local-file)
 *  - `jarPath` is non-null
 *  - NOT inside Gradle's own managed cache (i.e. local Maven repo, custom file repos, etc.)
 *
 * These are the artifacts that can change without any build-file edit — e.g. a republished
 * local Maven SNAPSHOT — and must therefore be included in cache invalidation checks.
 */
export function collectLocalArtifactJarPaths(output: ResolutionOutput): string[] {
  const seen = new Set<string>();
  for (const mod of output.modules) {
    for (const cfg of mod.configurations) {
      for (const art of cfg.artifacts) {
        if (art.origin !== 'external') continue;
        if (!art.jarPath) continue;
        const abs = path.resolve(art.jarPath);
        if (isGradleManagedJar(abs)) continue;
        seen.add(abs);
      }
    }
  }
  return [...seen].sort();
}

/**
 * SHA-256 (64 lowercase hex) over the content of all local (non-Gradle-managed) external JARs
 * in `output`, sorted by absolute path.
 *
 * Returns the sentinel string `"none"` when there are no local artifacts — this allows the
 * cache to skip the local-artifact validation step without special-casing at the call site.
 *
 * Each JAR that exists on disk contributes `<absPath>:<sha256(content)>` to the digest.
 * A JAR that is listed in `output` but is absent from disk contributes `<absPath>:absent`,
 * ensuring the cache is invalidated when a local Maven artifact is deleted.
 */
export function computeLocalArtifactDigest(output: ResolutionOutput): string {
  const paths = collectLocalArtifactJarPaths(output);
  if (paths.length === 0) {
    return 'none';
  }

  const lines: string[] = [];
  for (const jarPath of paths) {
    let fileHash: string;
    try {
      const buf = fs.readFileSync(jarPath);
      fileHash = createHash('sha256').update(buf).digest('hex');
    } catch {
      fileHash = 'absent';
    }
    lines.push(`${jarPath}:${fileHash}`);
  }

  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
