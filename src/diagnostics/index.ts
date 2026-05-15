export { FailureSeverity, DIAGNOSTIC_FILE_SEVERITIES } from './failure-severity.js';
export type { DiagnosticRecord, DiagnosticSubprocess } from './diagnostic-record.js';
export { resolveGlobalLogRoot, ensureLogTree, type LogRootResult } from './log-root.js';
export { recordFailureDiagnostic, diagnosticShortId, type RecordFailureParams, type RecordFailureResult } from './record-failure.js';
export { mapPublicFailureToDiagnostic, type PublicFailureCode, type MapFailureResult } from './map-failure.js';
export { appendNdjsonLine } from './rolling-log.js';
export { tailText, DIAGNOSTIC_STREAM_TAIL_BYTES } from './text-tail.js';
export { registerDiagnosticsCli } from './cli-diagnostics-command.js';
