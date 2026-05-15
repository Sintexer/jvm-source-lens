import { randomUUID } from 'node:crypto';
import { buildDiagnosticContextSync, readToolVersionFromPackage } from './build-context.js';
import type { DiagnosticRecord, DiagnosticSubprocess } from './diagnostic-record.js';
import { maybeWriteDiagnosticFile } from './diagnostic-files.js';
import { mapPublicFailureToDiagnostic, type PublicFailureCode } from './map-failure.js';
import { appendNdjsonLine } from './rolling-log.js';
import { resolveGlobalLogRoot, ensureLogTree } from './log-root.js';
import { redactSecretsInString, sanitizeDiagnosticInput } from './sanitize-input.js';
import { tailText } from './text-tail.js';
import { FailureSeverity, DIAGNOSTIC_FILE_SEVERITIES } from './failure-severity.js';

export type RecordFailureParams = {
  operation: string;
  publicCode: PublicFailureCode;
  message: string;
  projectRoot: string;
  buildSystem?: string | null;
  /** Raw input; sanitized before persistence. */
  input?: Record<string, unknown>;
  subprocess?: DiagnosticSubprocess;
  stack?: string | null;
  /** INTERNAL / unexpected paths only */
  forceSeverity?: (typeof FailureSeverity)[keyof typeof FailureSeverity];
  forceErrorCode?: string;
};

export type RecordFailureResult = {
  /** Present when a `diagnostics/<id>.json` snapshot was written (README §6.3). */
  diagnosticId?: string;
  hint?: string;
};

function subprocessForRecord(sp: DiagnosticSubprocess | undefined): DiagnosticSubprocess | undefined {
  if (!sp) {
    return undefined;
  }
  return {
    command: sp.command.map((c) => redactSecretsInString(c)),
    exitCode: sp.exitCode,
    stdout: tailText(redactSecretsInString(sp.stdout)),
    stderr: tailText(redactSecretsInString(sp.stderr)),
  };
}

/**
 * Writes one diagnostic line and optionally `diagnostics/<id>.json`. Never throws.
 */
export function recordFailureDiagnostic(params: RecordFailureParams): RecordFailureResult {
  const logRootRes = resolveGlobalLogRoot();
  if (!logRootRes.ok) {
    return {};
  }

  const mapped = mapPublicFailureToDiagnostic(params.publicCode, params.message);
  const severity = params.forceSeverity ?? mapped.severity;
  const errorCode = params.forceErrorCode ?? mapped.errorCode;
  const id = randomUUID();
  const stack =
    severity === FailureSeverity.INTERNAL && params.stack
      ? redactSecretsInString(params.stack).slice(0, 32_000)
      : null;

  const record: DiagnosticRecord = {
    id,
    timestamp: new Date().toISOString(),
    severity,
    toolVersion: readToolVersionFromPackage(),
    operation: params.operation,
    input: sanitizeDiagnosticInput({
      ...params.input,
      projectRoot: params.projectRoot,
    }),
    message: redactSecretsInString(params.message).slice(0, 16_000),
    errorCode,
    stack,
    context: buildDiagnosticContextSync({
      projectRoot: params.projectRoot,
      buildSystem: params.buildSystem === undefined ? 'gradle' : params.buildSystem,
    }),
    subprocess: subprocessForRecord(params.subprocess),
  };

  try {
    ensureLogTree(logRootRes.path);
    appendNdjsonLine(logRootRes.path, JSON.stringify(record));
    const wantFile = DIAGNOSTIC_FILE_SEVERITIES.has(severity);
    const wrote = wantFile && maybeWriteDiagnosticFile(logRootRes.path, severity, record);
    if (wrote) {
      return {
        diagnosticId: id,
        hint: `Run \`jvmsrc diagnostics show ${id}\` for details.`,
      };
    }
  } catch {
    /* never fail user-visible work */
  }

  return {};
}

export function diagnosticShortId(fullId: string): string {
  return fullId.replace(/-/g, '').slice(0, 8);
}
