import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DependencyResolver } from '../resolvers/base.js';
import { detectResolver, resolverById } from '../resolvers/index.js';
import type { ResolutionOutput } from '../resolvers/resolution-output.js';
import { parseResolutionJson, validateResolutionOutput } from '../resolvers/resolution-output.js';
import {
  canonicalProjectRoot,
  computeProjectRootDigestFull,
  ensureReservedCacheDirs,
  getProjectResolutionCacheDir,
  writeFileAtomicSameDir,
} from './paths.js';
import { computeLocalArtifactDigest } from './local-artifact-digest.js';

export { COMMON_SKIP_DIR_NAMES, walkProjectTree, type WalkProjectTreeOptions } from './walk-project-tree.js';

/** Relative paths of declared build inputs (SPEC §6.1), sorted, POSIX-style separators. */
export function listBuildInputRelativePaths(
  projectRoot: string,
  resolver?: DependencyResolver,
): string[] {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const active = resolver ?? detectResolver(rootAbs);
  return active.cacheInputs(rootAbs).files;
}

/**
 * SHA-256 (64 lowercase hex) over sorted build-input paths (`rel:sha256`) followed by synthetic
 * `env:<key>:<value>` lines supplied by the resolver (`null` = synthetic empty inputs).
 */
export function computeBuildInputsDigest(
  projectRoot: string,
  resolver?: DependencyResolver | null,
): string {
  const rootAbs = canonicalProjectRoot(projectRoot);
  const active = resolver === undefined ? detectResolver(rootAbs) : resolver;
  const inputs = active ? active.cacheInputs(rootAbs) : { files: [], env: [] };
  const lines: string[] = [];
  for (const rel of inputs.files) {
    const full = path.join(rootAbs, rel);
    const buf = fs.readFileSync(full);
    const fileHex = createHash('sha256').update(buf).digest('hex');
    lines.push(`${rel}:${fileHex}`);
  }
  for (const [key, value] of inputs.env) {
    lines.push(`env:${key}:${value}`);
  }
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

export type BucketMetaV1 = {
  cacheMetaVersion: 1;
  projectRootAbsolute: string;
  projectRootDigestFull: string;
  writtenAt: string;
};

export type CachedResolutionRead =
  | { ok: true; output: ResolutionOutput }
  | { ok: false; reason: string };

export type WriteCachedResolutionResult = { ok: true } | { ok: false; message: string };

function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Indexes are now one file per scope (`class-search-index.<hash>.json`); nothing reads the old single slot. */
function removeLegacyClassSearchIndex(bucketDir: string): void {
  try {
    fs.unlinkSync(path.join(bucketDir, 'class-search-index.json'));
  } catch {
    /* absent or not removable: harmless */
  }
}

export function readCachedResolution(
  projectRoot: string,
  resolver?: DependencyResolver,
): CachedResolutionRead {
  const canonical = canonicalProjectRoot(projectRoot);
  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, reason: bucketRes.message };
  }
  const bucketDir = bucketRes.dir;
  removeLegacyClassSearchIndex(bucketDir);

  let activeResolver: DependencyResolver;
  try {
    activeResolver = resolver ?? detectResolver(canonical);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }

  const hashPath = path.join(bucketDir, 'resolution.hash');
  const jsonPath = path.join(bucketDir, 'resolution.json');
  const localHashPath = path.join(bucketDir, 'local-artifact.hash');

  const storedHash = readTextIfExists(hashPath);
  if (storedHash == null) {
    return { ok: false, reason: 'No resolution.hash in cache bucket' };
  }

  const expectedDigest = computeBuildInputsDigest(canonical, activeResolver);
  const trimmed = storedHash.trim().toLowerCase();
  if (trimmed !== expectedDigest.toLowerCase()) {
    return { ok: false, reason: 'resolution.hash does not match current build inputs' };
  }

  const jsonText = readTextIfExists(jsonPath);
  if (jsonText == null) {
    return { ok: false, reason: 'No resolution.json in cache bucket' };
  }

  let raw: unknown;
  try {
    raw = parseResolutionJson(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Invalid resolution.json: ${msg}` };
  }

  const validated = validateResolutionOutput(raw);
  if (!validated.ok) {
    return { ok: false, reason: validated.message };
  }

  if (validated.output.buildSystem.type !== activeResolver.id) {
    return {
      ok: false,
      reason: `Cached resolution buildSystem.type (${validated.output.buildSystem.type}) does not match resolver (${activeResolver.id})`,
    };
  }

  const outRoot = path.resolve(validated.output.projectRoot);
  if (outRoot !== canonical) {
    return {
      ok: false,
      reason: `Cached resolution.projectRoot (${validated.output.projectRoot}) does not match canonical root (${canonical})`,
    };
  }

  // Validate mutable local external JARs — e.g. local Maven SNAPSHOTs can be republished
  // without any build-file change, so their content is checked separately.
  const storedLocalHash = readTextIfExists(localHashPath);
  if (storedLocalHash == null) {
    return { ok: false, reason: 'No local-artifact.hash in cache bucket' };
  }
  const freshLocalHash = computeLocalArtifactDigest(validated.output, activeResolver);
  if (storedLocalHash.trim().toLowerCase() !== freshLocalHash.toLowerCase()) {
    return { ok: false, reason: 'local-artifact.hash does not match current local artifact content' };
  }

  return { ok: true, output: validated.output };
}

/**
 * Persists resolution cache files. Writes `resolution.json` first, then `resolution.hash`,
 * then `bucket-meta.json`, each via temp+rename in the bucket directory so concurrent readers
 * are less likely to see a torn combination.
 */
export function writeCachedResolution(
  projectRoot: string,
  output: ResolutionOutput,
  buildInputsDigest: string,
  resolver?: DependencyResolver,
): WriteCachedResolutionResult {
  const canonical = canonicalProjectRoot(projectRoot);
  const reserved = ensureReservedCacheDirs();
  if (!reserved.ok) {
    return { ok: false, message: reserved.message };
  }

  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, message: bucketRes.message };
  }
  const bucketDir = bucketRes.dir;
  fs.mkdirSync(bucketDir, { recursive: true });

  const meta: BucketMetaV1 = {
    cacheMetaVersion: 1,
    projectRootAbsolute: canonical,
    projectRootDigestFull: computeProjectRootDigestFull(canonical),
    writtenAt: new Date().toISOString(),
  };

  const activeResolver = resolver ?? resolverById(output.buildSystem.type);

  try {
    writeFileAtomicSameDir(path.join(bucketDir, 'resolution.json'), `${JSON.stringify(output)}\n`);
    writeFileAtomicSameDir(path.join(bucketDir, 'resolution.hash'), `${buildInputsDigest.toLowerCase()}\n`);
    writeFileAtomicSameDir(
      path.join(bucketDir, 'local-artifact.hash'),
      `${computeLocalArtifactDigest(output, activeResolver).toLowerCase()}\n`,
    );
    writeFileAtomicSameDir(path.join(bucketDir, 'bucket-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to write resolution cache: ${msg}` };
  }

  return { ok: true };
}
