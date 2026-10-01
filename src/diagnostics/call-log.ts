import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ensureLogTree, resolveGlobalLogRoot } from './log-root.js';
import { appendNdjsonLine } from './rolling-log.js';
import { sanitizeDiagnosticInput } from './sanitize-input.js';

export const CALL_LOG_FILE_NAME = 'calls.log';

/** Opt-in MCP call log (`JVMSRC_CALL_LOG=1`); used to measure first-call success and top error codes. */
export function isCallLogEnabled(): boolean {
  const raw = process.env.JVMSRC_CALL_LOG?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export type CallLogRecord = {
  timestamp: string;
  sessionId: string;
  seq: number;
  firstCallOfSession: boolean;
  tool: string;
  input: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
  errorCategory: string | null;
  code: string | null;
  textChars: number;
};

/** One MCP server process ≈ one agent session. */
const sessionId = randomUUID();
let nextSeq = 0;

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function summarizeToolResult(result: CallToolResult | undefined): {
  isError: boolean;
  errorCategory: string | null;
  code: string | null;
  textChars: number;
} {
  if (!result) {
    return { isError: true, errorCategory: null, code: 'THROWN', textChars: 0 };
  }
  const structured = (result.structuredContent ?? {}) as Record<string, unknown>;
  const textChars = (result.content ?? []).reduce(
    (n, c) => n + (c.type === 'text' ? c.text.length : 0),
    0,
  );
  return {
    isError: Boolean(result.isError),
    errorCategory: str((result as Record<string, unknown>).errorCategory) ?? str(structured.errorCategory),
    code: str(structured.code),
    textChars,
  };
}

function writeRecord(record: CallLogRecord): void {
  const root = resolveGlobalLogRoot();
  if (!root.ok) {
    return;
  }
  try {
    ensureLogTree(root.path);
    appendNdjsonLine(root.path, JSON.stringify(record), CALL_LOG_FILE_NAME);
  } catch {
    /* logging must never affect tool results */
  }
}

/** Wraps an MCP tool callback; a no-op passthrough unless `JVMSRC_CALL_LOG` is set. Never throws on its own. */
export function withCallLog<A, R extends CallToolResult>(
  tool: string,
  handler: (args: A, extra: never) => Promise<R> | R,
): (args: A, extra: never) => Promise<R> {
  return async (args, extra) => {
    if (!isCallLogEnabled()) {
      return handler(args, extra);
    }
    const seq = nextSeq++;
    const started = Date.now();
    let result: R | undefined;
    try {
      result = await handler(args, extra);
      return result;
    } finally {
      writeRecord({
        timestamp: new Date().toISOString(),
        sessionId,
        seq,
        firstCallOfSession: seq === 0,
        tool,
        input: sanitizeDiagnosticInput(args as Record<string, unknown>),
        durationMs: Date.now() - started,
        ...summarizeToolResult(result),
      });
    }
  };
}
