import type { FindInClassSourceResult } from '../find-in-class-source.js';
import { formatProvenanceLine } from './format-provenance.js';

export function formatFindInClassSourceText(
  result: Extract<FindInClassSourceResult, { ok: true; found: true }>,
): string {
  const lines: string[] = [
    `find_in_class_source: ${result.totalMatches} match(es) for ${JSON.stringify(result.query)} in ${result.className}`,
    result.lineNumbersReliable ? '' : '(line numbers approximate; decompiled source)',
    '',
  ].filter(Boolean);

  for (const h of result.hits) {
    lines.push(`${h.line}:${h.column}  ${h.matchedText.trim()}`);
    const ctxBefore = h.contextBefore.filter((l) => l.length > 0);
    const ctxAfter = h.contextAfter.filter((l) => l.length > 0);
    if (ctxBefore.length > 0) {
      lines.push(`  ^ ${ctxBefore[ctxBefore.length - 1]!.trimEnd()}`);
    }
    if (ctxAfter.length > 0) {
      lines.push(`  v ${ctxAfter[0]!.trimEnd()}`);
    }
  }

  if (result.truncated) {
    lines.push('');
    lines.push(`Showing ${result.hitCount} of ${result.totalMatches} hit(s).`);
  }
  lines.push('');
  lines.push(formatProvenanceLine(result.provenance));
  lines.push('');
  lines.push('Use full=true for JSON hits with full context arrays.');
  return lines.join('\n');
}

export function formatFindInClassNoMatchText(
  result: Extract<FindInClassSourceResult, { ok: true; found: false }>,
): string {
  return [
    `find_in_class_source: no matches for ${JSON.stringify(result.query)} in ${result.className}`,
    result.description,
    '',
    'Use full=true for structured JSON.',
  ].join('\n');
}
