import type { ArtifactCoordinates } from '../../extractor/class-source-types.js';
import { parseSourcesJarJson } from './sources-jar-output.js';
import { runGradleTask, type GradleSpawnResult } from './spawn-gradle.js';

export type ResolveSourcesJarResult =
  | { ok: true; sourcesJarPath: string | null }
  | { ok: false; message: string; stderr?: string };

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
    return { ok: false, message: spawned.message, stderr: spawned.stderr };
  }

  const parsed = parseSourcesJarJson(spawned.stdout);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, stderr: spawned.stderr || undefined };
  }

  return { ok: true, sourcesJarPath: parsed.output.sourcesJarPath };
}
