import type { GetMethodSignatureResult } from '../get-method-signatures.js';
import { METHOD_NOT_FOUND_ON_CLASS_LINES, MODIFIER_LEGEND } from '../copy/hints.js';
import { formatJavapOverloadLine } from './format-method-line.js';
import { formatProvenanceLine } from './format-provenance.js';

export function formatMethodSignatureText(result: Extract<GetMethodSignatureResult, { ok: true }>): string {
  const lines: string[] = [
    `Method ${result.methodName} on ${result.className} — ${result.overloads.length} overload(s); sourceAvailable=${result.sourceAvailable}`,
    '',
  ];
  if (!result.methodFound) {
    lines.push(...METHOD_NOT_FOUND_ON_CLASS_LINES);
    return lines.join('\n');
  }
  for (const o of result.overloads) {
    lines.push(
      formatJavapOverloadLine(o, { methodName: result.methodName, className: result.className }),
    );
  }
  lines.push('');
  lines.push(formatProvenanceLine(result.provenance));
  lines.push(MODIFIER_LEGEND);
  return lines.join('\n');
}
