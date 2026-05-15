import type { ClassSourceLookupResult } from './extractor/class-source-types.js';

export type CliGetResult = ClassSourceLookupResult;

export type CliGetOutputOptions = {
  /** When true, success writes only Java source to stdout (no metadata on stderr). Ignored when `json` is true. */
  quiet?: boolean;
  /** When true, write one JSON object to stdout for success or failure; nothing to stderr. */
  json?: boolean;
};

export function writeCliGetResult(result: CliGetResult, options?: CliGetOutputOptions): void {
  const quiet = options?.quiet ?? false;
  const json = options?.json ?? false;

  if (json) {
    if (result.ok) {
      console.log(
        JSON.stringify({
          source: result.source,
          sourceAvailable: result.sourceAvailable,
          className: result.className,
          provenance: result.provenance,
        }),
      );
      return;
    }
    console.log(JSON.stringify({ error: true, ...result.error }));
    process.exitCode = 1;
    return;
  }

  if (result.ok) {
    process.stdout.write(result.source);
    if (!quiet) {
      console.error(
        JSON.stringify({
          sourceAvailable: result.sourceAvailable,
          className: result.className,
          provenance: result.provenance,
        }),
      );
    }
    return;
  }
  console.error(JSON.stringify({ error: true, ...result.error }));
  process.exitCode = 1;
}
