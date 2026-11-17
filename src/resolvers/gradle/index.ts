import fs from 'node:fs';
import path from 'node:path';
import type {
  ArtifactCoordinates,
  BuildCacheInputs,
  DependencyResolver,
  ResolutionResult,
  ResolveOptions,
  ResolveSourcesJarResult,
  ResolvedArtifact,
  SubprocessCapture,
  SubprocessHooks,
} from '../base.js';
import { validateResolutionOutput, parseResolutionJson } from '../resolution-output.js';
import {
  gradleCacheInputs,
  gradleUserHome,
  isGradleManagedJar,
  listGradleBuildInputRelativePaths,
} from './cache-inputs.js';
import { resolveSourcesJar, type ResolveSourcesJarGradleOptions } from './resolve-sources-jar.js';
import { runGradleTask, type GradleSpawnResult } from './spawn-gradle.js';

export {
  gradleCacheInputs,
  gradleUserHome,
  isGradleManagedJar,
  listGradleBuildInputRelativePaths,
} from './cache-inputs.js';
export {
  resolveSourcesJar,
  type ResolveSourcesJarGradleOptions,
  type ResolveSourcesJarResult,
} from './resolve-sources-jar.js';

const GRADLE_DETECT_MARKERS = [
  'settings.gradle',
  'settings.gradle.kts',
  'build.gradle',
  'build.gradle.kts',
] as const;

const GRADLE_ROOT_MARKERS = ['settings.gradle', 'settings.gradle.kts', 'gradlew'] as const;

function hasGradleRootMarker(dir: string): boolean {
  return GRADLE_ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

/** Nearest ancestor (or `start` itself) holding `gradlew` / `settings.gradle(.kts)`, or `null`. */
export function findGradleRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (hasGradleRootMarker(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function captureFromSpawn(spawned: {
  command: string[];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}): SubprocessCapture {
  return {
    command: spawned.command,
    exitCode: spawned.exitCode ?? null,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
  };
}

export class GradleResolver implements DependencyResolver {
  readonly id = 'gradle';
  readonly displayName = 'Gradle';
  readonly rootHint = 'gradlew or settings.gradle(.kts)';

  detect(projectRoot: string): boolean {
    const root = path.resolve(projectRoot);
    return GRADLE_DETECT_MARKERS.some((n) => fs.existsSync(path.join(root, n)));
  }

  findBuildRoot(start: string): string | null {
    return findGradleRoot(start);
  }

  cacheInputs(projectRoot: string): BuildCacheInputs {
    return gradleCacheInputs(projectRoot);
  }

  isImmutableArtifact(artifact: ResolvedArtifact): boolean {
    return Boolean(artifact.jarPath) && isGradleManagedJar(artifact.jarPath!);
  }

  /** Invokes Gradle with the bundled init script; `options` supports subprocess hooks / stderr. */
  async resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolutionResult> {
    const root = path.resolve(projectRoot);
    if (!this.detect(root)) {
      return {
        ok: false,
        message:
          'Not a Gradle project (no settings.gradle[kts] or build.gradle[kts] at project root)',
      };
    }

    const inherit = Boolean(options?.inheritStderr ?? options?.inheritGradleStderr);
    let spawned: GradleSpawnResult;
    try {
      if (options?.onBeforeResolve) {
        options.onBeforeResolve({ resolverId: this.id, displayName: this.displayName });
      } else {
        options?.onBeforeGradle?.();
      }
      spawned = await runGradleTask(root, 'jvmsrcResolve', undefined, { inheritStderr: inherit });
    } finally {
      if (options?.onAfterResolve) {
        options.onAfterResolve();
      } else {
        options?.onAfterGradle?.();
      }
    }

    if (!spawned.ok) {
      const capture = captureFromSpawn(spawned);
      return {
        ok: false,
        message: spawned.message,
        stderr: spawned.stderr,
        subprocess: capture,
        gradle: capture,
      };
    }

    let raw: unknown;
    try {
      raw = parseResolutionJson(spawned.stdout);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const capture = captureFromSpawn({ ...spawned, exitCode: 0 });
      return {
        ok: false,
        message: `Could not parse Gradle JSON output: ${msg}`,
        stderr: spawned.stderr || undefined,
        subprocess: capture,
        gradle: capture,
      };
    }

    const validated = validateResolutionOutput(raw);
    if (!validated.ok) {
      const capture = captureFromSpawn({ ...spawned, exitCode: 0 });
      return {
        ok: false,
        message: validated.message,
        stderr: spawned.stderr || undefined,
        subprocess: capture,
        gradle: capture,
      };
    }

    return { ok: true, output: validated.output };
  }

  async resolveSourcesJar(
    projectRoot: string,
    coordinates: ArtifactCoordinates,
    hooks?: SubprocessHooks,
  ): Promise<ResolveSourcesJarResult> {
    return resolveSourcesJar(projectRoot, coordinates, hooks as ResolveSourcesJarGradleOptions | undefined);
  }
}
