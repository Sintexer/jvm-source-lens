import type { ArtifactCoordinates, ResolveJavadocJarResult, ResolveSourcesJarResult, SubprocessHooks } from '../base.js';
import { parseResolutionJson } from '../resolution-output.js';
import { captureFromSpawn, runMavenAnalyzer, type MavenSpawnResult } from './spawn-maven.js';

export function parseMavenSourcesJson(
  text: string,
): { ok: true; sourcesJarPath: string | null; reason?: string } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = parseResolutionJson(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Could not parse Maven sources JSON output: ${msg}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Maven sources output is not a JSON object' };
  }
  const sourcesJarPath = (raw as Record<string, unknown>).sourcesJarPath;
  if (
    sourcesJarPath !== null &&
    sourcesJarPath !== undefined &&
    typeof sourcesJarPath !== 'string'
  ) {
    return { ok: false, message: 'Invalid sourcesJarPath in Maven output' };
  }
  const reason = (raw as Record<string, unknown>).reason;
  return {
    ok: true,
    sourcesJarPath: typeof sourcesJarPath === 'string' ? sourcesJarPath : null,
    ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
  };
}

async function runClassifierLookup(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  modeArgs: string[],
  hooks?: SubprocessHooks,
) {
  let spawned: MavenSpawnResult;
  try {
    hooks?.onBeforeResolve?.({ resolverId: 'maven', displayName: 'Maven' });
    spawned = await runMavenAnalyzer(
      projectRoot,
      [
        ...modeArgs,
        `-Djvmsrc.group=${coordinates.group}`,
        `-Djvmsrc.artifact=${coordinates.name}`,
        `-Djvmsrc.version=${coordinates.version ?? ''}`,
      ],
      { inheritStderr: Boolean(hooks?.inheritStderr) },
    );
  } finally {
    hooks?.onAfterResolve?.();
  }

  if (!spawned.ok) {
    return {
      ok: false as const,
      message: spawned.message,
      stderr: spawned.stderr,
      subprocess: captureFromSpawn(spawned),
    };
  }
  return spawned;
}

export async function resolveMavenSourcesJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  hooks?: SubprocessHooks,
): Promise<ResolveSourcesJarResult> {
  if (!coordinates.version) return { ok: true, sourcesJarPath: null };
  const spawned = await runClassifierLookup(projectRoot, coordinates, ['-Djvmsrc.mode=sources'], hooks);
  if (!spawned.ok) return spawned;
  const parsed = parseMavenSourcesJson(spawned.outputText);
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.message,
      stderr: spawned.stderr || undefined,
      subprocess: captureFromSpawn({ ...spawned, exitCode: 0 }),
    };
  }

  return {
    ok: true,
    sourcesJarPath: parsed.sourcesJarPath,
    ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
  };
}

export async function resolveMavenJavadocJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  moduleName: string,
  hooks?: SubprocessHooks,
): Promise<ResolveJavadocJarResult> {
  if (!coordinates.version) return { ok: true, javadocJarPath: null };
  const spawned = await runClassifierLookup(
    projectRoot, coordinates, ['-Djvmsrc.mode=javadoc', `-Djvmsrc.module=${moduleName}`], hooks,
  );
  if (!spawned.ok) return spawned;
  const failure = (message: string) => ({
    ok: false as const, message, stderr: spawned.stderr || undefined,
    subprocess: captureFromSpawn({ ...spawned, exitCode: 0 }),
  });
  try {
    const raw: unknown = parseResolutionJson(spawned.outputText);
    if (raw && typeof raw === 'object') {
      if ('error' in raw && typeof raw.error === 'string') return failure(raw.error);
      if ('javadocJarPath' in raw && (raw.javadocJarPath === null ||
          (typeof raw.javadocJarPath === 'string' && raw.javadocJarPath.length > 0))) {
        return { ok: true, javadocJarPath: raw.javadocJarPath };
      }
    }
    return failure('Invalid or missing javadocJarPath in Maven output');
  } catch (e) {
    return failure(`Invalid Maven Javadoc output: ${e instanceof Error ? e.message : String(e)}`);
  }
}
