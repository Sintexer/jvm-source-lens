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
}

export type BuildCacheInputs = {
  /** Sorted relative POSIX paths of build input files under `projectRoot`. */
  files: string[];
  /** Synthetic `[key, value]` pairs appended to the digest as `env:<key>:<value>`. */
  env: Array<[string, string]>;
};

export type ResolveSourcesJarResult =
  | {
      ok: true;
      sourcesJarPath: string | null;
      /** Why there is no sources JAR (Maven analyzer message, credentials removed). */
      reason?: string;
    }
  | {
      ok: false;
      message: string;
      stderr?: string;
      subprocess?: SubprocessCapture;
    };

export type ResolutionResult =
  | { ok: true; output: ResolutionOutput }
  | {
      ok: false;
      message: string;
      stderr?: string;
      subprocess?: SubprocessCapture;
      diagnosticId?: string;
      hint?: string;
    };

export interface DependencyResolver {
  /** Matches `ResolutionOutput.buildSystem.type` (e.g. `'gradle'`, `'maven'`). */
  readonly id: string;
  /** Human-facing build tool name (e.g. `'Gradle'`, `'Maven'`). */
  readonly displayName: string;
  /** Root marker hint for error guidance (e.g. `'gradlew or settings.gradle(.kts)'`). */
  readonly rootHint: string;
  /**
   * Configuration names that hold the compile and test-compile classpaths, in lookup order.
   * Used to pick a configuration when the caller gives none, and in error messages.
   * When omitted, selection falls back to the configuration `scope` only.
   */
  readonly configurationNames?: Readonly<Record<'compile' | 'test-compile', readonly string[]>>;
  detect(projectRoot: string): boolean;
  findBuildRoot(start: string): string | null;
  cacheInputs(projectRoot: string): BuildCacheInputs;
  /** `projectRoot` lets a resolver read project-level settings (e.g. Maven local repository). */
  isImmutableArtifact(artifact: ResolvedArtifact, projectRoot: string): boolean;
  resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolutionResult>;
  resolveSourcesJar(
    projectRoot: string,
    coordinates: ArtifactCoordinates,
    hooks?: SubprocessHooks,
  ): Promise<ResolveSourcesJarResult>;
}
