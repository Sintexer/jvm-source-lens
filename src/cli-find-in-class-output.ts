import type { FindInClassSourceResult } from './find-in-class-source.js';

export type CliFindInClassOutputOptions = {
  json?: boolean;
};

export function writeCliFindInClassResult(
  result: FindInClassSourceResult,
  options?: CliFindInClassOutputOptions,
): void {
  const json = options?.json ?? false;
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
    console.error(result.description);
    process.exitCode = 1;
    return;
  }

  for (const hit of result.hits) {
    const loc = hit.block
      ? `lines ${hit.block.startLine}-${hit.block.endLine}`
      : `line ${hit.line}, column ${hit.column}`;
    console.log(`--- ${loc} ---`);
    for (const line of hit.contextBefore) {
      console.log(line);
    }
    console.log(hit.matchedText);
    for (const line of hit.contextAfter) {
      console.log(line);
    }
    console.log('');
  }
  if (result.truncated) {
    console.error(
      `(${result.hitCount} of ${result.totalMatches} match(es) shown; increase --max-hits or narrow the query)`,
    );
  }
}
