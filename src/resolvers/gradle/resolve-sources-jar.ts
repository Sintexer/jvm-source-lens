import type {
  ArtifactCoordinates,
  ResolveSourcesJarResult,
  SubprocessCapture,
  SubprocessHooks,
} from '../base.js';
import { parseSourcesJarJson } from './sources-jar-output.js';
import { runGradleTask, type GradleSpawnResult } from './spawn-gradle.js';

export type { ResolveSourcesJarResult } from '../base.js';

function captureFromSpawn(s: GradleSpawnResult): SubprocessCapture {
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

/** Appends the last non-empty stderr lines so a bare "Gradle exited with code 1" is actionable. */
export function withStderrTail(message: string, stderr: string | undefined, maxLines = 3): string {
  const lines = (stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-maxLines);
  return lines.length > 0 ? `${message}: ${lines.join(' | ')}` : message;
}

/** @deprecated Use `SubprocessHooks`. Kept for one release. */
export type ResolveSourcesJarGradleOptions = SubprocessHooks & {
  /** @deprecated Use `onBeforeResolve`. Kept for one release. */
  onBeforeGradle?: () => void;
  /** @deprecated Use `onAfterResolve`. Kept for one release. */
  onAfterGradle?: () => void;
};

/**
 * Resolves (and downloads if needed) the sources JAR for one Maven module using
 * Gradle's ArtifactResolutionQuery. Uses project repositories; caches under ~/.gradle.
 */
export async function resolveSourcesJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  hooks?: ResolveSourcesJarGradleOptions,
): Promise<ResolveSourcesJarResult> {
  const version = coordinates.version;
  if (version === null || version.length === 0) {
    return { ok: true, sourcesJarPath: null };
  }

  let spawned: GradleSpawnResult;
  try {
    if (hooks?.onBeforeResolve) {
      hooks.onBeforeResolve({ resolverId: 'gradle', displayName: 'Gradle' });
    } else {
      hooks?.onBeforeGradle?.();
    }
    spawned = await runGradleTask(
      projectRoot,
      'jvmsrcResolveSources',
      {
        jvmsrcGroup: coordinates.group,
        jvmsrcName: coordinates.name,
        jvmsrcVersion: version,
      },
      { inheritStderr: Boolean(hooks?.inheritStderr) },
    );
  } finally {
    if (hooks?.onAfterResolve) {
      hooks.onAfterResolve();
    } else {
      hooks?.onAfterGradle?.();
    }
  }

  if (!spawned.ok) {
    const capture = captureFromSpawn(spawned);
    return {
      ok: false,
      message: withStderrTail(spawned.message, spawned.stderr),
      stderr: spawned.stderr,
      subprocess: capture,
      gradle: capture,
    };
  }

  const parsed = parseSourcesJarJson(spawned.stdout);
  if (!parsed.ok) {
    const capture = captureFromSpawn(spawned);
    return {
      ok: false,
      message: parsed.message,
      stderr: spawned.stderr || undefined,
      subprocess: capture,
      gradle: capture,
    };
  }

  return { ok: true, sourcesJarPath: parsed.output.sourcesJarPath };
}
