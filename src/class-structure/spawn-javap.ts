import path from 'node:path';
import { buildCfrSpawnEnv } from '../decompiler/cfr-spawn-env.js';
import { resolveJavaExecutable } from '../decompiler/resolve-java-executable.js';

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

async function readStreamCapped(
  stream: number | ReadableStream<Uint8Array> | undefined,
  maxBytes: number,
): Promise<{ text: string; exceeded: boolean }> {
  if (stream == null || typeof stream === 'number') {
    return { text: '', exceeded: false };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        return { text: '', exceeded: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    return { text: '', exceeded: false };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), exceeded: false };
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
  const java = resolveJavaExecutable();
  if (!java.ok) {
    return java;
  }
  if (java.javaPath === 'java') {
    return { ok: true, javapPath: 'javap' };
  }
  return { ok: true, javapPath: path.join(path.dirname(java.javaPath), 'javap') };
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

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, {
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

  const stdoutP = readStreamCapped(proc.stdout, maxOutputBytes);
  const stderrP = readStreamCapped(proc.stderr, DEFAULT_JAVAP_MAX_STDERR_BYTES);
  const exitCode = await proc.exited;
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
