import path from 'node:path';
import { getBundledResource } from '../../bundled-resources.js';
import { awaitChildExit, readProcessStreamToText, spawnChild } from '../../spawn-child.js';
import { formatGradleUserMessage } from './gradle-failure-message.js';
import { resolveGradleWrapperCommand } from './gradle-wrapper-command.js';

export { resolveGradleWrapperCommand } from './gradle-wrapper-command.js';

/** Default wall-clock cap for each Gradle invocation. Override with `JVMSRC_GRADLE_TIMEOUT_MS`. */
export const DEFAULT_GRADLE_TIMEOUT_MS = 600_000;

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

export function gradleTimeoutMs(): number {
  return parsePositiveIntEnv('JVMSRC_GRADLE_TIMEOUT_MS', DEFAULT_GRADLE_TIMEOUT_MS);
}

export type GradleSpawnResult =
  | { ok: true; stdout: string; stderr: string; command: string[] }
  | {
      ok: false;
      message: string;
      stderr?: string;
      stdout?: string;
      command: string[];
      exitCode: number | null;
    };

export type RunGradleSpawnOptions = {
  /** When true, Gradle stderr is inherited by the process (stdout stays piped for JSON). */
  inheritStderr?: boolean;
  /** Wall-clock limit (ms). Defaults to `gradleTimeoutMs()`; tests may pass a small value. */
  timeoutMs?: number;
};

/**
 * Runs a root-project Gradle task with the bundled jvmsrc init script.
 */
export async function runGradleTask(
  projectRoot: string,
  task: string,
  projectProperties?: Record<string, string>,
  spawnOptions?: RunGradleSpawnOptions,
): Promise<GradleSpawnResult> {
  const root = path.resolve(projectRoot);
  const initScript = getBundledResource('analyzer-init.gradle');
  const wrapper = resolveGradleWrapperCommand(root);
  const useWrapper = wrapper.useWrapper;

  const props: Record<string, string> = {
    jvmsrcWrapper: useWrapper ? 'true' : 'false',
    ...projectProperties,
  };

  const argv: string[] = [...wrapper.command];

  for (const [key, value] of Object.entries(props)) {
    argv.push(`-P${key}=${value}`);
  }

  argv.push('--no-configuration-cache', '--init-script', initScript, '--quiet', task);

  let proc: ReturnType<typeof spawnChild>;
  try {
    proc = spawnChild(argv, {
      cwd: root,
      stdout: 'pipe',
      stderr: spawnOptions?.inheritStderr ? 'inherit' : 'pipe',
      stdin: 'ignore',
      env: process.env,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: formatGradleUserMessage({
        task,
        kind: 'spawn',
        message: `Failed to start Gradle: ${msg}`,
        command: argv,
        usedWrapper: useWrapper,
      }),
      command: argv,
      exitCode: null,
    };
  }

  const timeoutMs = spawnOptions?.timeoutMs ?? gradleTimeoutMs();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      readProcessStreamToText(proc.stdout),
      readProcessStreamToText(proc.stderr),
      awaitChildExit(proc),
    ]);
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: formatGradleUserMessage({
        task,
        kind: 'spawn',
        message: `Failed to start Gradle: ${msg}`,
        command: argv,
        usedWrapper: useWrapper,
      }),
      command: argv,
      exitCode: null,
    };
  }
  clearTimeout(timer);

  if (timedOut) {
    return {
      ok: false,
      message: formatGradleUserMessage({
        task,
        kind: 'timeout',
        message: `Gradle timed out after ${timeoutMs}ms (task ${task})`,
        command: argv,
        usedWrapper: useWrapper,
      }),
      stderr: stderr || undefined,
      stdout,
      command: argv,
      exitCode: null,
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      message: formatGradleUserMessage({
        task,
        kind: 'exit',
        message: `Gradle exited with code ${exitCode}`,
        stderr,
        stdout,
        command: argv,
        usedWrapper: useWrapper,
      }),
      stderr: stderr || undefined,
      stdout,
      command: argv,
      exitCode,
    };
  }

  return { ok: true, stdout, stderr, command: argv };
}
