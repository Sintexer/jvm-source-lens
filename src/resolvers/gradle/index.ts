import fs from 'node:fs';
import path from 'node:path';
import type { DependencyResolver, ResolutionResult, ResolveOptions } from '../base.js';
import { validateResolutionOutput, parseResolutionJson } from '../resolution-output.js';
import { runGradleTask } from './spawn-gradle.js';

export { resolveSourcesJar, type ResolveSourcesJarResult } from './resolve-sources-jar.js';

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

    const spawned = await runGradleTask(root, 'jvmsrcResolve');
    if (!spawned.ok) {
      return { ok: false, message: spawned.message, stderr: spawned.stderr };
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
      };
    }

    const validated = validateResolutionOutput(raw);
    if (!validated.ok) {
      return { ok: false, message: validated.message, stderr: spawned.stderr || undefined };
    }

    return { ok: true, output: validated.output };
  }
}
