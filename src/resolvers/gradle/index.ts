import fs from 'node:fs';
import path from 'node:path';
import type { DependencyResolver, GradleProcessCapture, ResolutionResult, ResolveOptions } from '../base.js';
import { validateResolutionOutput, parseResolutionJson } from '../resolution-output.js';
import { runGradleTask, type GradleSpawnResult } from './spawn-gradle.js';

export { resolveSourcesJar, type ResolveSourcesJarResult } from './resolve-sources-jar.js';

function gradleCaptureFromSpawn(spawned: {
  command: string[];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}): GradleProcessCapture {
  return {
    command: spawned.command,
    exitCode: spawned.exitCode ?? null,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
  };
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
    const root = path.resolve(projectRoot);
    if (!this.detect(root)) {
      return {
        ok: false,
        message:
          'Not a Gradle project (no settings.gradle[kts] or build.gradle[kts] at project root)',
      };
    }

    const inherit = Boolean(_options?.inheritGradleStderr);
    let spawned: GradleSpawnResult;
    try {
      _options?.onBeforeGradle?.();
      spawned = await runGradleTask(root, 'jvmsrcResolve', undefined, { inheritStderr: inherit });
    } finally {
      _options?.onAfterGradle?.();
    }

    if (!spawned.ok) {
      return {
        ok: false,
        message: spawned.message,
        stderr: spawned.stderr,
        gradle: gradleCaptureFromSpawn(spawned),
      };
    }

    let raw: unknown;
    try {
      raw = parseResolutionJson(spawned.stdout);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: `Could not parse Gradle JSON output: ${msg}`,
        stderr: spawned.stderr || undefined,
        gradle: gradleCaptureFromSpawn({ ...spawned, exitCode: 0 }),
      };
    }

    const validated = validateResolutionOutput(raw);
    if (!validated.ok) {
      return {
        ok: false,
        message: validated.message,
        stderr: spawned.stderr || undefined,
        gradle: gradleCaptureFromSpawn({ ...spawned, exitCode: 0 }),
      };
    }

    return { ok: true, output: validated.output };
  }
}
