import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DependencyResolver } from '../resolvers/base.js';
import { resolverById } from '../resolvers/index.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { sha256File } from './sha256-file.js';

/**
 * Collects JAR paths from `output` that are:
 *  - `origin: 'external'` (not interproject, not local-file)
 *  - `jarPath` is non-null
 *  - NOT marked immutable by the owning build-system resolver (e.g. local Maven SNAPSHOTs
 *    or custom file repositories that can change without editing build files).
 */
export function collectLocalArtifactJarPaths(
  output: ResolutionOutput,
  resolver: DependencyResolver | undefined = resolverById(output.buildSystem.type),
): string[] {
  const seen = new Set<string>();
  for (const mod of output.modules) {
    for (const cfg of mod.configurations) {
      for (const art of cfg.artifacts) {
        if (art.origin !== 'external') continue;
        if (!art.jarPath) continue;
        const abs = path.resolve(art.jarPath);
        if (resolver?.isImmutableArtifact({ ...art, jarPath: abs }, output.projectRoot)) continue;
        seen.add(abs);
      }
    }
  }
  return [...seen].sort();
}

/**
 * SHA-256 (64 lowercase hex) over the content of all mutable local external JARs in `output`,
 * sorted by absolute path.
 *
 * Returns `"none"` when there are no mutable local artifacts.
 * Each existing JAR contributes `<absPath>:<sha256(content)>`; an absent JAR contributes
 * `<absPath>:absent` so deleting a local artifact invalidates the cache.
 */
export function computeLocalArtifactDigest(
  output: ResolutionOutput,
  resolver?: DependencyResolver,
): string {
  const paths = collectLocalArtifactJarPaths(output, resolver);
  if (paths.length === 0) {
    return 'none';
  }

  const lines: string[] = [];
  for (const jarPath of paths) {
    let fileHash: string;
    try {
      fileHash = sha256File(jarPath);
    } catch {
      fileHash = 'absent';
    }
    lines.push(`${jarPath}:${fileHash}`);
  }

  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
