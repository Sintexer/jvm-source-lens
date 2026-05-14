import fs from 'node:fs';
import path from 'node:path';
import { getBundledResource } from '../../bundled-resources.js';
import type { DependencyResolver, ResolutionResult, ResolveOptions } from '../base.js';
import type { ResolutionOutput } from '../resolution-output.js';
import { parseResolutionJson, validateResolutionOutput } from '../resolution-output.js';

async function streamToText(
  stream: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> {
  if (stream == null || typeof stream === 'number') {
    return '';
  }
  return await Bun.readableStreamToText(stream);
}

export class GradleResolver implements DependencyResolver {
  detect(projectRoot: string): boolean {
    const root = path.resolve(projectRoot);
    const markers = [
      'settings.gradle',
      'settings.gradle.kts',
      'build.gradle',
      'build.gradle.kts',
    ];
    return markers.some((n) => fs.existsSync(path.join(root, n)));
  }

  /** Invokes Gradle with the bundled init script; `options` reserved for future filtering. */
  async resolve(projectRoot: string, _options?: ResolveOptions): Promise<ResolutionResult> {
    void _options;
    const root = path.resolve(projectRoot);
    if (!this.detect(root)) {
      return {
        ok: false,
        message:
          'Not a Gradle project (no settings.gradle[kts] or build.gradle[kts] at project root)',
      };
    }

    const initScript = getBundledResource('analyzer-init.gradle');
    const useWrapper = fs.existsSync(path.join(root, 'gradlew'));
    const wrapperProp = `-PjvmOracleWrapper=${useWrapper ? 'true' : 'false'}`;

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

    argv.push(
      wrapperProp,
      '--no-configuration-cache',
      '--init-script',
      initScript,
      '--quiet',
      'jvmOracleResolve',
    );

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

    const stdoutP = streamToText(proc.stdout);
    const stderrP = streamToText(proc.stderr);
    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutP,
      stderrP,
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return {
        ok: false,
        message: `Gradle exited with code ${exitCode}`,
        stderr: stderr || undefined,
      };
    }

    let raw: unknown;
    try {
      raw = parseResolutionJson(stdout);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: `Could not parse Gradle JSON output: ${msg}`,
        stderr: stderr || undefined,
      };
    }

    const validated = validateResolutionOutput(raw);
    if (!validated.ok) {
      return { ok: false, message: validated.message, stderr: stderr || undefined };
    }

    const output: ResolutionOutput = validated.output;
    return { ok: true, output };
  }
}
