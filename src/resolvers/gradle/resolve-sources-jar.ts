import type { ArtifactCoordinates } from '../../extractor/class-source-types.js';
import type { GradleProcessCapture } from '../base.js';
import { parseSourcesJarJson } from './sources-jar-output.js';
import { runGradleTask, type GradleSpawnResult } from './spawn-gradle.js';

export type ResolveSourcesJarResult =
  | { ok: true; sourcesJarPath: string | null }
  | { ok: false; message: string; stderr?: string; gradle?: GradleProcessCapture };

function gradleCaptureFromSpawn(s: GradleSpawnResult): GradleProcessCapture {
  if (s.ok) {
    return { command: s.command, exitCode: 0, stdout: s.stdout, stderr: s.stderr };
  }
  return {
    command: s.command,
    exitCode: s.exitCode,
    stdout: s.stdout ?? '',
    stderr: s.stderr ?? '',
  };
}

export type ResolveSourcesJarGradleOptions = {
  inheritStderr?: boolean;
  onBeforeGradle?: () => void;
  onAfterGradle?: () => void;
};

/**
 * Resolves (and downloads if needed) the sources JAR for one Maven module using
 * Gradle's ArtifactResolutionQuery. Uses project repositories; caches under ~/.gradle.
 */
export async function resolveSourcesJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  gradle?: ResolveSourcesJarGradleOptions,
): Promise<ResolveSourcesJarResult> {
  const version = coordinates.version;
  if (version === null || version.length === 0) {
    return { ok: true, sourcesJarPath: null };
  }

  let spawned: GradleSpawnResult;
  try {
    gradle?.onBeforeGradle?.();
    spawned = await runGradleTask(
      projectRoot,
      'jvmsrcResolveSources',
      {
        jvmsrcGroup: coordinates.group,
        jvmsrcName: coordinates.name,
        jvmsrcVersion: version,
      },
      { inheritStderr: Boolean(gradle?.inheritStderr) },
    );
  } finally {
    gradle?.onAfterGradle?.();
  }

  if (!spawned.ok) {
    return {
      ok: false,
      message: spawned.message,
      stderr: spawned.stderr,
      gradle: gradleCaptureFromSpawn(spawned),
    };
  }

  const parsed = parseSourcesJarJson(spawned.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.message,
      stderr: spawned.stderr || undefined,
      gradle: gradleCaptureFromSpawn(spawned),
    };
  }

  return { ok: true, sourcesJarPath: parsed.output.sourcesJarPath };
}
