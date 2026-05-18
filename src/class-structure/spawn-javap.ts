import fs from 'node:fs';
import path from 'node:path';
import { awaitChildExit, readProcessStreamCapped, spawnChild } from '../spawn-child.js';
import { buildCfrSpawnEnv } from '../decompiler/cfr-spawn-env.js';
import { resolveJavaBinExecutable } from '../decompiler/resolve-java-bin.js';

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

export const DEFAULT_JAVAP_TIMEOUT_MS = 60_000;
export const DEFAULT_JAVAP_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_JAVAP_MAX_STDERR_BYTES = 256 * 1024;

export function javapTimeoutMs(): number {
  return parsePositiveIntEnv('JVMSRC_JAVAP_TIMEOUT_MS', DEFAULT_JAVAP_TIMEOUT_MS);
}

export function javapMaxOutputBytes(): number {
  return parsePositiveIntEnv('JVMSRC_JAVAP_MAX_OUTPUT_BYTES', DEFAULT_JAVAP_MAX_OUTPUT_BYTES);
}

export type JavapVerboseOptions = {
  /** Classpath entry: JAR file or exploded classes directory (e.g. Gradle `build/classes/java/main`). */
  classpath: string;
  className: string;
  javaPath?: string;
  javapPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type JavapVerboseResult =
  | { ok: true; stdout: string }
  | { ok: false; message: string; stderr?: string };

export function resolveJavapExecutable(): { ok: true; javapPath: string } | { ok: false; message: string } {
  const java = resolveJavaBinExecutable('java');
  const javap = resolveJavaBinExecutable('javap');
  if (java.path !== 'java' && java.path !== 'java.exe') {
    const sibling = path.join(path.dirname(java.path), path.basename(javap.path));
    if (fs.existsSync(sibling)) {
      return { ok: true, javapPath: sibling };
    }
  }
  return { ok: true, javapPath: javap.path };
}

/**
 * Runs `javap -classpath <classpath> -private -verbose <fqn>` for signature extraction.
 */
export async function spawnJavapVerbose(opts: JavapVerboseOptions): Promise<JavapVerboseResult> {
  let javapPath = opts.javapPath;
  if (!javapPath) {
    const j = resolveJavapExecutable();
    if (!j.ok) {
      return { ok: false, message: j.message };
    }
    javapPath = j.javapPath;
  }

  const timeoutMs = opts.timeoutMs ?? javapTimeoutMs();
  const maxOutputBytes = opts.maxOutputBytes ?? javapMaxOutputBytes();
  const spawnEnv = buildCfrSpawnEnv();

  const argv = [
    javapPath,
    '-classpath',
    opts.classpath,
    '-private',
    '-verbose',
    opts.className,
  ];

  let proc: ReturnType<typeof spawnChild>;
  try {
    proc = spawnChild(argv, {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      env: spawnEnv,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `Failed to start javap: ${msg}. Set JAVA_HOME or ensure javap is on PATH.`,
    };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  const stdoutP = readProcessStreamCapped(proc.stdout, maxOutputBytes);
  const stderrP = readProcessStreamCapped(proc.stderr, DEFAULT_JAVAP_MAX_STDERR_BYTES);

  let exitCode: number;
  try {
    exitCode = await awaitChildExit(proc);
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `javap process failed to start: ${msg}. Set JAVA_HOME or ensure javap is on PATH.`,
    };
  }
  clearTimeout(timer);

  const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);

  if (timedOut) {
    return {
      ok: false,
      message: `javap timed out after ${timeoutMs}ms`,
      stderr: stderr.text || undefined,
    };
  }

  if (stdout.exceeded) {
    return {
      ok: false,
      message: `javap stdout exceeded ${maxOutputBytes} bytes`,
      stderr: stderr.text || undefined,
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      message: `javap exited with code ${exitCode}`,
      stderr: stderr.text || undefined,
    };
  }

  const text = stdout.text.trimEnd();
  if (text.length === 0) {
    return {
      ok: false,
      message: 'javap produced empty output',
      stderr: stderr.text || undefined,
    };
  }

  return { ok: true, stdout: text };
}
