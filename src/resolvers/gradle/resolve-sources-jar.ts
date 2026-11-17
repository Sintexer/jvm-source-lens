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

/**
 * Resolves (and downloads if needed) the sources JAR for one Maven module using
 * Gradle's ArtifactResolutionQuery. Uses project repositories; caches under ~/.gradle.
 */
export async function resolveSourcesJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  hooks?: SubprocessHooks,
): Promise<ResolveSourcesJarResult> {
  const version = coordinates.version;
  if (version === null || version.length === 0) {
    return { ok: true, sourcesJarPath: null };
  }

  let spawned: GradleSpawnResult;
  try {
    hooks?.onBeforeResolve?.({ resolverId: 'gradle', displayName: 'Gradle' });
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
    hooks?.onAfterResolve?.();
  }

  if (!spawned.ok) {
    return {
      ok: false,
      message: withStderrTail(spawned.message, spawned.stderr),
      stderr: spawned.stderr,
      subprocess: captureFromSpawn(spawned),
    };
  }

  const parsed = parseSourcesJarJson(spawned.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.message,
      stderr: spawned.stderr || undefined,
      subprocess: captureFromSpawn(spawned),
    };
  }

  return { ok: true, sourcesJarPath: parsed.output.sourcesJarPath };
}
