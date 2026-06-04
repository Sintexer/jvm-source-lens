export const SUPPORTED_RESOLUTION_SCHEMA_VERSIONS = ['1.0', '1.1', '1.2'] as const;

export type ResolutionSchemaVersion = (typeof SUPPORTED_RESOLUTION_SCHEMA_VERSIONS)[number];

export interface BuildSystemInfo {
  type: 'gradle' | 'maven';
  version: string;
  wrapper: boolean;
}

export interface InterprojectRef {
  moduleName: string;
  modulePath: string;
}

export interface ResolvedArtifact {
  group: string;
  name: string;
  version: string | null;
  type: 'jar' | 'project' | 'local-file';
  jarPath: string | null;
  /** Omitted in Gradle 1.1 JSON when absent; normalized to `null` after parse. */
  sourcesJarPath?: string | null;
  origin: 'external' | 'interproject' | 'local-file';
  direct: boolean;
  interproject?: InterprojectRef;
}

export interface ResolvedConfiguration {
  name: string;
  scope: 'compile' | 'runtime' | 'test-compile' | 'test-runtime';
  artifacts: ResolvedArtifact[];
}

export interface ResolvedModule {
  name: string;
  path: string;
  configurations: ResolvedConfiguration[];
}

export interface ResolutionError {
  module: string;
  configuration?: string;
  message: string;
  fatal: boolean;
}

export interface ResolutionOutput {
  schemaVersion: string;
  resolvedAt: string;
  buildSystem: BuildSystemInfo;
  projectRoot: string;
  modules: ResolvedModule[];
  errors: ResolutionError[];
  /**
   * Java major version required by the project's Gradle toolchain configuration, if any.
   * Emitted by the init script (schema 1.2+) when `java { toolchain { languageVersion } }` is set.
   * Used by jvmsrc on the next invocation to select the right JDK without re-running Gradle.
   * Absent (undefined) when no toolchain is configured or on older schema versions.
   */
  javaToolchainVersion?: number;
}

export type ResolutionParseResult =
  | { ok: true; output: ResolutionOutput }
  | { ok: false; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseResolutionJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new SyntaxError('No JSON object found in Gradle output');
  }
}

export function validateResolutionOutput(raw: unknown): ResolutionParseResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Resolution output is not a JSON object' };
  }

  const schemaVersion = raw.schemaVersion;
  if (
    typeof schemaVersion !== 'string' ||
    !SUPPORTED_RESOLUTION_SCHEMA_VERSIONS.includes(schemaVersion as ResolutionSchemaVersion)
  ) {
    return {
      ok: false,
      message: `Unsupported or missing schemaVersion (got ${String(schemaVersion)}; supported: ${SUPPORTED_RESOLUTION_SCHEMA_VERSIONS.join(', ')})`,
    };
  }

  const buildSystem = raw.buildSystem;
  if (!isRecord(buildSystem) || buildSystem.type !== 'gradle') {
    return { ok: false, message: 'Missing or invalid buildSystem.type (expected "gradle")' };
  }

  if (typeof buildSystem.version !== 'string' || typeof buildSystem.wrapper !== 'boolean') {
    return { ok: false, message: 'Invalid buildSystem.version or buildSystem.wrapper' };
  }

  if (typeof raw.projectRoot !== 'string') {
    return { ok: false, message: 'Missing or invalid projectRoot' };
  }
  if (typeof raw.resolvedAt !== 'string') {
    return { ok: false, message: 'Missing or invalid resolvedAt' };
  }
  if (!Array.isArray(raw.modules)) {
    return { ok: false, message: 'Missing or invalid modules array' };
  }
  if (!Array.isArray(raw.errors)) {
    return { ok: false, message: 'Missing or invalid errors array' };
  }

  const output = raw as unknown as ResolutionOutput;
  normalizeResolutionOutput(output);
  return { ok: true, output };
}

/** Fills optional / omitted artifact fields after JSON parse (schema 1.1 omits null `sourcesJarPath`). */
export function normalizeResolutionOutput(output: ResolutionOutput): ResolutionOutput {
  for (const mod of output.modules) {
    for (const cfg of mod.configurations) {
      for (const art of cfg.artifacts) {
        if (art.jarPath === undefined) {
          (art as { jarPath: string | null }).jarPath = null;
        }
        if (art.sourcesJarPath === undefined) {
          (art as { sourcesJarPath: string | null }).sourcesJarPath = null;
        }
      }
    }
  }
  return output;
}
