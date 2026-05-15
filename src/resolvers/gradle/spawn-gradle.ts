import fs from 'node:fs';
import path from 'node:path';
import { getBundledResource } from '../../bundled-resources.js';

async function streamToText(
  stream: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> {
  if (stream == null || typeof stream === 'number') {
    return '';
  }
  return await Bun.readableStreamToText(stream);
}

export type GradleSpawnResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; message: string; stderr?: string };

/**
 * Runs a root-project Gradle task with the bundled jvmsrc init script.
 */
export async function runGradleTask(
  projectRoot: string,
  task: string,
  projectProperties?: Record<string, string>,
): Promise<GradleSpawnResult> {
  const root = path.resolve(projectRoot);
  const initScript = getBundledResource('analyzer-init.gradle');
  const useWrapper = fs.existsSync(path.join(root, 'gradlew'));

  const props: Record<string, string> = {
    jvmsrcWrapper: useWrapper ? 'true' : 'false',
    ...projectProperties,
  };

  const argv: string[] = [];
  if (useWrapper) {
    const gw = path.join(root, 'gradlew');
    try {
      fs.accessSync(gw, fs.constants.X_OK);
      argv.push(gw);
    } catch {
      argv.push('bash', gw);
    }
  } else {
    argv.push('gradle');
  }

  for (const [key, value] of Object.entries(props)) {
    argv.push(`-P${key}=${value}`);
  }

  argv.push('--no-configuration-cache', '--init-script', initScript, '--quiet', task);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      env: process.env,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to start Gradle: ${msg}` };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    streamToText(proc.stdout),
    streamToText(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      ok: false,
      message: `Gradle exited with code ${exitCode}`,
      stderr: stderr || undefined,
    };
  }

  return { ok: true, stdout, stderr };
}
