import fs from 'node:fs';
import path from 'node:path';
import { parseResolutionJson, validateResolutionOutput } from '../resolvers/resolution-output.js';
import { canonicalProjectRoot, getProjectResolutionCacheDir } from './paths.js';

/**
 * Reads `javaToolchainVersion` from the project's previously persisted `resolution.json`, if any.
 *
 * Intentionally ignores `resolution.hash` and `local-artifact.hash`: this hint is needed precisely
 * when build inputs changed or `forceRefresh` is requested and the build tool is about to re-run.
 * Never throws.
 */
export function readCachedJavaToolchainVersion(projectRoot: string): number | undefined {
  try {
    const canonical = canonicalProjectRoot(projectRoot);
    const bucketRes = getProjectResolutionCacheDir(canonical);
    if (!bucketRes.ok) {
      return undefined;
    }
    const jsonPath = path.join(bucketRes.dir, 'resolution.json');
    if (!fs.existsSync(jsonPath)) {
      return undefined;
    }
    const raw = parseResolutionJson(fs.readFileSync(jsonPath, 'utf8'));
    const validated = validateResolutionOutput(raw);
    if (!validated.ok) {
      return undefined;
    }
    if (path.resolve(validated.output.projectRoot) !== canonical) {
      return undefined;
    }
    const v = validated.output.javaToolchainVersion;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
  } catch {
    return undefined;
  }
}
