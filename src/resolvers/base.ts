export { getBundledResource, type BundledResourceName } from '../bundled-resources.js';

export type {
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

import type { ResolutionOutput } from './resolution-output.js';

export interface ResolveOptions {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  /** Gradle: stream stderr to the terminal (CLI `--verbose`). */
  inheritGradleStderr?: boolean;
  /** Gradle: invoked immediately before `runGradleTask` for this resolve. */
  onBeforeGradle?: () => void;
  /** Gradle: invoked when this resolve's Gradle process has exited (success or failure). */
  onAfterGradle?: () => void;
}

export type ResolutionResult =
  | { ok: true; output: ResolutionOutput }
  | { ok: false; message: string; stderr?: string };

export interface DependencyResolver {
  detect(projectRoot: string): boolean;
  resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolutionResult>;
}
