import fs from 'node:fs';
import path from 'node:path';
import { canonicalProjectRoot, getProjectResolutionCacheDir, writeFileAtomicSameDir } from '../cache/paths.js';

export const JAR_FQN_CACHE_FILE = 'jar-fqn-cache.json';

export type JarFqnCacheFileV1 = {
  formatVersion: 1;
  jars: Record<string, { statKey: string; fqns: string[] }>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function statKeyForJar(jarPath: string): string | null {
  try {
    const st = fs.statSync(jarPath);
    if (!st.isFile()) {
      return null;
    }
    return `${Math.floor(st.mtimeMs)}:${st.size}`;
  } catch {
    return null;
  }
}

export function readJarFqnCache(projectRoot: string): JarFqnCacheFileV1 | null {
  const canonical = canonicalProjectRoot(projectRoot);
  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return null;
  }
  const p = path.join(bucketRes.dir, JAR_FQN_CACHE_FILE);
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.formatVersion !== 1) {
    return null;
  }
  const jars = raw.jars;
  if (!isRecord(jars)) {
    return null;
  }
  const out: JarFqnCacheFileV1['jars'] = {};
  for (const [k, v] of Object.entries(jars)) {
    if (!isRecord(v) || typeof v.statKey !== 'string' || !Array.isArray(v.fqns)) {
      return null;
    }
    if (!v.fqns.every((x) => typeof x === 'string')) {
      return null;
    }
    out[k] = { statKey: v.statKey, fqns: v.fqns as string[] };
  }
  return { formatVersion: 1, jars: out };
}

export function writeJarFqnCache(projectRoot: string, file: JarFqnCacheFileV1): { ok: true } | { ok: false; message: string } {
  const canonical = canonicalProjectRoot(projectRoot);
  const bucketRes = getProjectResolutionCacheDir(canonical);
  if (!bucketRes.ok) {
    return { ok: false, message: bucketRes.message };
  }
  try {
    fs.mkdirSync(bucketRes.dir, { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
  const dest = path.join(bucketRes.dir, JAR_FQN_CACHE_FILE);
  try {
    writeFileAtomicSameDir(dest, `${JSON.stringify(file)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
  return { ok: true };
}

export function emptyJarFqnCache(): JarFqnCacheFileV1 {
  return { formatVersion: 1, jars: {} };
}
