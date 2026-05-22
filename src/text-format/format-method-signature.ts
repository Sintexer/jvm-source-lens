import type { GetMethodSignatureResult } from '../get-method-signatures.js';
import { formatJavapOverloadLine } from './format-method-line.js';
import { formatProvenanceLine } from './format-provenance.js';

export function formatMethodSignatureText(result: Extract<GetMethodSignatureResult, { ok: true }>): string {
  const lines: string[] = [
    `Method ${result.methodName} on ${result.className} — ${result.overloads.length} overload(s); sourceAvailable=${result.sourceAvailable}`,
    '',
  ];
  if (!result.methodFound) {
    lines.push('No overloads matched this method name (constructors use <init>).');
    lines.push('Use get_class_structure scope=overview to browse declared method names.');
    return lines.join('\n');
  }
  for (const o of result.overloads) {
    lines.push(formatJavapOverloadLine(o));
  }
  lines.push('');
  lines.push(formatProvenanceLine(result.provenance));
  lines.push('');
  lines.push('Use full=true for structured JSON overload objects.');
  return lines.join('\n');
}
