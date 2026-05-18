import crossSpawn from 'cross-spawn';
import { Readable } from 'node:stream';
import { text as readStreamText } from 'node:stream/consumers';

export type SpawnStdio = 'pipe' | 'inherit' | 'ignore';

export type SpawnChildOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: SpawnStdio;
  stderr?: SpawnStdio;
  stdin?: SpawnStdio;
};

/** Piped process output (Web stream after normalization). */
export type ProcessStream = ReadableStream<Uint8Array> | null;

export type SpawnedChild = {
  stdout: ProcessStream;
  stderr: ProcessStream;
  exited: Promise<number>;
  kill: () => void;
};

function isBunSpawnAvailable(): boolean {
  if (process.env.JVMSRC_TEST_FORCE_NODE_SPAWN === '1') {
    return false;
  }
  const bun = globalThis.Bun;
  return bun !== undefined && typeof bun.spawn === 'function';
}

function pipedStream(
  stream: number | ReadableStream<Uint8Array> | undefined,
): ProcessStream {
  if (stream == null || typeof stream === 'number') {
    return null;
  }
  return stream;
}

function nodeReadableToWeb(readable: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(readable) as ReadableStream<Uint8Array>;
}

/**
 * Spawns a subprocess using Bun when available, otherwise `cross-spawn` (Windows `.bat`,
 * PATHEXT, shebangs). Piped stdout/stderr are always exposed as Web `ReadableStream`s.
 */
export function spawnChild(argv: string[], options: SpawnChildOptions = {}): SpawnedChild {
  const stdoutMode = options.stdout ?? 'pipe';
  const stderrMode = options.stderr ?? 'pipe';
  const stdinMode = options.stdin ?? 'ignore';

  if (isBunSpawnAvailable()) {
    const proc = globalThis.Bun.spawn(argv, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdout: stdoutMode,
      stderr: stderrMode,
      stdin: stdinMode,
    });
    return {
      stdout: pipedStream(proc.stdout),
      stderr: pipedStream(proc.stderr),
      exited: proc.exited,
      kill: () => {
        proc.kill();
      },
    };
  }

  const proc = crossSpawn(argv[0]!, argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: [stdinMode, stdoutMode, stderrMode],
  });

  const mapPiped = (
    stream: Readable | null,
    mode: SpawnStdio,
  ): ProcessStream => {
    if (mode !== 'pipe' || stream == null) {
      return null;
    }
    return nodeReadableToWeb(stream);
  };

  return {
    stdout: mapPiped(proc.stdout, stdoutMode),
    stderr: mapPiped(proc.stderr, stderrMode),
    exited: new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      proc.once('error', (err: Error) => {
        settle(() => reject(err));
      });
      proc.once('close', (code: number | null) => {
        settle(() => resolve(code ?? 1));
      });
    }),
    kill: () => {
      proc.kill();
    },
  };
}

export async function readProcessStreamToText(
  stream: ProcessStream | number | undefined,
): Promise<string> {
  if (stream == null || typeof stream === 'number') {
    return '';
  }

  const bun = globalThis.Bun;
  if (bun !== undefined) {
    return await bun.readableStreamToText(stream);
  }

  return await readStreamText(Readable.fromWeb(stream));
}

export async function readProcessStreamCapped(
  stream: ProcessStream | number | undefined,
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
