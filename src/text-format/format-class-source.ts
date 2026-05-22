import type { ClassSourceLookupResult } from '../extractor/class-source-types.js';
import { formatProvenanceLine } from './format-provenance.js';

/** Compact MCP: source body + plain provenance footer (CLI get already prints .java on stdout). */
export function formatClassSourceCompactText(result: Extract<ClassSourceLookupResult, { ok: true }>): string {
  const excerpt =
    result.excerpt !== undefined
      ? `\nExcerpt: matched ${result.excerpt.matchedMethodNames.join(', ')}` +
        (result.excerpt.unmatchedMethodNames.length > 0
          ? `; unmatched: ${result.excerpt.unmatchedMethodNames.join(', ')}`
          : '') +
        (result.excerpt.lineNumbersReliable ? '' : '; line numbers approximate')
      : '';
  const trunc = result.outputTruncated
    ? `\n(source truncated from ${result.sourceLength} chars; use methodNames excerpt or full=true)`
    : '';
  return (
    result.source +
    '\n---\n' +
    formatProvenanceLine(result.provenance) +
    `\nsourceAvailable: ${result.sourceAvailable}` +
    excerpt +
    trunc
  );
}
