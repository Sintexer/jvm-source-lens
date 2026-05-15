import type { ClassSourceLookupResult } from './extractor/class-source-types.js';

export type CliGetResult = ClassSourceLookupResult;

export type CliGetOutputOptions = {
  /** When true, success writes only Java source to stdout (no metadata on stderr). */
  quiet?: boolean;
};

export function writeCliGetResult(result: CliGetResult, options?: CliGetOutputOptions): void {
  const quiet = options?.quiet ?? false;

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
