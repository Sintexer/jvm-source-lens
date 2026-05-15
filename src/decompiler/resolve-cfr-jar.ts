import fs from 'node:fs';
import path from 'node:path';
import { getBundledResource } from '../bundled-resources.js';

export type ResolveCfrJarPathResult = { ok: true; path: string } | { ok: false; message: string };

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function resolveCandidate(rawPath: string, source: string): ResolveCfrJarPathResult {
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, message: `CFR JAR from ${source} not found: ${abs}` };
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Cannot stat CFR JAR from ${source} (${abs}): ${msg}` };
  }
  if (!st.isFile()) {
    return { ok: false, message: `CFR path from ${source} is not a file: ${abs}` };
  }
  if (!abs.toLowerCase().endsWith('.jar')) {
    return { ok: false, message: `CFR path from ${source} must be a .jar file: ${abs}` };
  }
  return { ok: true, path: abs };
}

/**
 * Resolves CFR JAR: `JVMSRC_CFR_PATH`, else legacy `JVM_ORACLE_CFR_PATH`, else bundled `cfr.jar`.
 */
export function resolveCfrJarPath(): ResolveCfrJarPathResult {
  const jvmsrc = trimEnv('JVMSRC_CFR_PATH');
  if (jvmsrc !== undefined) {
    return resolveCandidate(jvmsrc, 'JVMSRC_CFR_PATH');
  }
  const oracle = trimEnv('JVM_ORACLE_CFR_PATH');
  if (oracle !== undefined) {
    return resolveCandidate(oracle, 'JVM_ORACLE_CFR_PATH');
  }
  try {
    return { ok: true, path: getBundledResource('cfr.jar') };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Bundled CFR not available: ${msg}` };
  }
}
