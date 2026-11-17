export { getBundledResource, type BundledResourceName } from '../bundled-resources.js';

export type {
  ArtifactCoordinates,
  BuildSystemInfo,
  InterprojectRef,
  ResolutionError,
  ResolutionOutput,
  ResolutionParseResult,
  ResolvedArtifact,
  ResolvedConfiguration,
  ResolvedModule,
} from './resolution-output.js';

export { SUPPORTED_RESOLUTION_SCHEMA_VERSIONS } from './resolution-output.js';

import type {
  ArtifactCoordinates,
  ResolutionOutput,
  ResolvedArtifact,
} from './resolution-output.js';

export type ResolvePhaseInfo = {
  resolverId: string;
  displayName: string;
};

export type SubprocessCapture = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

/** @deprecated Use `SubprocessCapture`. Kept for one release. */
export type GradleProcessCapture = SubprocessCapture;

export type SubprocessHooks = {
  inheritStderr?: boolean;
  onBeforeResolve?: (info: ResolvePhaseInfo) => void;
  onAfterResolve?: () => void;
};

export interface ResolveOptions {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  /** Stream build-tool stderr to the terminal (CLI `--verbose`). */
  inheritStderr?: boolean;
  /** Invoked immediately before the build-tool subprocess starts. */
  onBeforeResolve?: (info: ResolvePhaseInfo) => void;
  /** Invoked when the build-tool subprocess has exited (success or failure). */
  onAfterResolve?: () => void;
  /** @deprecated Use `inheritStderr`. Kept for one release. */
  inheritGradleStderr?: boolean;
  /** @deprecated Use `onBeforeResolve`. Kept for one release. */
  onBeforeGradle?: () => void;
  /** @deprecated Use `onAfterResolve`. Kept for one release. */
  onAfterGradle?: () => void;
}

export type BuildCacheInputs = {
  /** Sorted relative POSIX paths of build input files under `projectRoot`. */
  files: string[];
  /** Synthetic `[key, value]` pairs appended to the digest as `env:<key>:<value>`. */
  env: Array<[string, string]>;
};

export type ResolveSourcesJarResult =
  | { ok: true; sourcesJarPath: string | null }
  | {
      ok: false;
      message: string;
      stderr?: string;
      subprocess?: SubprocessCapture;
      /** @deprecated Use `subprocess`. Kept for one release. */
      gradle?: GradleProcessCapture;
    };

export type ResolutionResult =
  | { ok: true; output: ResolutionOutput }
  | {
      ok: false;
      message: string;
      stderr?: string;
      subprocess?: SubprocessCapture;
      /** @deprecated Use `subprocess`. Kept for one release. */
      gradle?: GradleProcessCapture;
      diagnosticId?: string;
      hint?: string;
    };

export interface DependencyResolver {
  /** Matches `ResolutionOutput.buildSystem.type` (e.g. `'gradle'`). */
  readonly id: string;
  /** Human-facing build tool name (e.g. `'Gradle'`). */
  readonly displayName: string;
  /** Root marker hint for error guidance (e.g. `'gradlew or settings.gradle(.kts)'`). */
  readonly rootHint: string;
  detect(projectRoot: string): boolean;
  findBuildRoot(start: string): string | null;
  cacheInputs(projectRoot: string): BuildCacheInputs;
  isImmutableArtifact(artifact: ResolvedArtifact): boolean;
  resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolutionResult>;
  resolveSourcesJar(
    projectRoot: string,
    coordinates: ArtifactCoordinates,
    hooks?: SubprocessHooks,
  ): Promise<ResolveSourcesJarResult>;
}
