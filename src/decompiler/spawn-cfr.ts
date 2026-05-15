import { buildCfrSpawnEnv } from './cfr-spawn-env.js';
import { resolveCfrJarPath } from './resolve-cfr-jar.js';
import { resolveJavaExecutable } from './resolve-java-executable.js';

/** Default CFR wall-clock timeout (ms). Override with `JVMSRC_CFR_TIMEOUT_MS`. */
export const DEFAULT_CFR_TIMEOUT_MS = 120_000;

/** Default max captured stdout bytes. Override with `JVMSRC_CFR_MAX_OUTPUT_BYTES`. */
export const DEFAULT_CFR_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const DEFAULT_CFR_MAX_STDERR_BYTES = 256 * 1024;

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

export function cfrTimeoutMs(): number {
  return parsePositiveIntEnv('JVMSRC_CFR_TIMEOUT_MS', DEFAULT_CFR_TIMEOUT_MS);
}

export function cfrMaxOutputBytes(): number {
  return parsePositiveIntEnv('JVMSRC_CFR_MAX_OUTPUT_BYTES', DEFAULT_CFR_MAX_OUTPUT_BYTES);
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

export type CfrDecompileOptions = {
  jarPath: string;
  className: string;
  javaPath?: string;
  cfrJarPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
};

export type CfrDecompileResult =
  | { ok: true; source: string }
  | { ok: false; message: string; stderr?: string; command?: string[] };

/**
 * Decompiles one class from a JAR via CFR (`java -jar cfr.jar <jar> <fqn> --silent true`).
 */
export async function runCfrDecompile(opts: CfrDecompileOptions): Promise<CfrDecompileResult> {
  let javaPath = opts.javaPath;
  if (!javaPath) {
    const java = resolveJavaExecutable();
    if (!java.ok) {
      return { ok: false, message: java.message };
    }
    javaPath = java.javaPath;
  }
  const cfrJar = opts.cfrJarPath ?? resolveCfrJarPath();
  const timeoutMs = opts.timeoutMs ?? cfrTimeoutMs();
  const maxOutputBytes = opts.maxOutputBytes ?? cfrMaxOutputBytes();
  const spawnEnv = opts.env ?? buildCfrSpawnEnv();

  const argv = [javaPath, '-jar', cfrJar, opts.jarPath, opts.className, '--silent', 'true'];

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
      message: `Failed to start Java for CFR: ${msg}. Set JAVA_HOME or ensure java is on PATH.`,
      command: argv,
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
  const stderrP = readStreamCapped(proc.stderr, DEFAULT_CFR_MAX_STDERR_BYTES);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);

  if (timedOut) {
    return {
      ok: false,
      message: `CFR timed out after ${timeoutMs}ms`,
      stderr: stderr.text || undefined,
      command: argv,
    };
  }

  if (stdout.exceeded) {
    return {
      ok: false,
      message: `CFR stdout exceeded ${maxOutputBytes} bytes`,
      stderr: stderr.text || undefined,
      command: argv,
    };
  }

  const source = stdout.text.trim();
  if (exitCode !== 0) {
    return {
      ok: false,
      message: `CFR exited with code ${exitCode}`,
      stderr: stderr.text || undefined,
      command: argv,
    };
  }
  if (source.length === 0) {
    return {
      ok: false,
      message: 'CFR produced no decompiled source',
      stderr: stderr.text || undefined,
      command: argv,
    };
  }

  return { ok: true, source };
}
