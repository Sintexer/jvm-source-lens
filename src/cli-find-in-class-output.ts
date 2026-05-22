import type { FindInClassSourceResult } from './find-in-class-source.js';
import {
  formatFindInClassNoMatchText,
  formatFindInClassSourceText,
} from './text-format/format-find-in-class.js';

export type CliFindInClassOutputOptions = {
  /** Full structured JSON on stdout (implies full detail). */
  json?: boolean;
  full?: boolean;
};

export function writeCliFindInClassResult(
  result: FindInClassSourceResult,
  options?: CliFindInClassOutputOptions,
): void {
  const json = Boolean(options?.json || options?.full);
  const failureExtras =
    !result.ok && result.diagnosticId !== undefined
      ? { diagnosticId: result.diagnosticId, ...(result.hint !== undefined ? { hint: result.hint } : {}) }
      : {};

  if (json) {
    if (!result.ok) {
      console.log(JSON.stringify({ error: true, ...result.error, ...failureExtras }));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result));
    if (!result.found) {
      process.exitCode = 1;
    }
    return;
  }

  if (!result.ok) {
    console.error(JSON.stringify({ error: true, ...result.error, ...failureExtras }));
    process.exitCode = 1;
    return;
  }

  if (!result.found) {
    console.log(formatFindInClassNoMatchText(result));
    process.exitCode = 1;
    return;
  }

  console.log(formatFindInClassSourceText(result));
  if (result.truncated) {
    console.error(
      `(${result.hitCount} of ${result.totalMatches} match(es) shown; increase --max-hits or narrow the query)`,
    );
  }
}
