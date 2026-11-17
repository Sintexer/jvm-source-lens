import type { ArtifactCoordinates, ResolveSourcesJarResult, SubprocessHooks } from '../base.js';
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

/**
 * Resolves (and downloads if needed) the `-sources.jar` for one Maven coordinate
 * using the bundled `maven-analyzer.jar` extension (`jvmsrc.mode=sources`).
 */
export async function resolveMavenSourcesJar(
  projectRoot: string,
  coordinates: ArtifactCoordinates,
  hooks?: SubprocessHooks,
): Promise<ResolveSourcesJarResult> {
  const version = coordinates.version;
  if (version === null || version.length === 0) {
    return { ok: true, sourcesJarPath: null };
  }

  let spawned: MavenSpawnResult;
  try {
    hooks?.onBeforeResolve?.({ resolverId: 'maven', displayName: 'Maven' });
    spawned = await runMavenAnalyzer(
      projectRoot,
      [
        '-Djvmsrc.mode=sources',
        `-Djvmsrc.group=${coordinates.group}`,
        `-Djvmsrc.artifact=${coordinates.name}`,
        `-Djvmsrc.version=${version}`,
      ],
      { inheritStderr: Boolean(hooks?.inheritStderr) },
    );
  } finally {
    hooks?.onAfterResolve?.();
  }

  if (!spawned.ok) {
    return {
      ok: false,
      message: spawned.message,
      stderr: spawned.stderr,
      subprocess: captureFromSpawn(spawned),
    };
  }

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
