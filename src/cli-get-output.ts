import type { ClassSourceLookupResult } from './extractor/class-source-types.js';

export type CliGetResult = ClassSourceLookupResult;

export function writeCliGetResult(result: CliGetResult): void {
  if (result.ok) {
    process.stdout.write(result.source);
    console.error(
      JSON.stringify({
        sourceAvailable: result.sourceAvailable,
        className: result.className,
        provenance: result.provenance,
      }),
    );
    return;
  }
  console.error(JSON.stringify({ error: true, ...result.error }));
  process.exitCode = 1;
}
