import type { FailureSeverity } from './failure-severity.js';

export type DiagnosticSubprocess = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type DiagnosticRecord = {
  id: string;
  timestamp: string;
  severity: FailureSeverity;
  toolVersion: string;

  operation: string;
  input: Record<string, unknown>;

  message: string;
  /** Stable granular code for operators (orthogonal to public API `code`). */
  errorCode: string;
  stack: string | null;

  context: {
    platform: string;
    arch: string;
    nodeVersion: string;
    javaVersion: string | null;
    gradleVersion: string | null;
    projectRoot: string;
    buildSystem: string | null;
    cacheDir: string;
  };

  subprocess?: DiagnosticSubprocess;
};
