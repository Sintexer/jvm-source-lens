import type { ClassStructureKind, ClassStructureMethod, GetClassStructureSuccess } from '../class-structure/types.js';
import { firstJavadocParagraph } from './truncate.js';
import { formatClassStructureMethodLine } from './format-method-line.js';
import { formatProvenanceLine } from './format-provenance.js';

export type ClassStructureScope = 'overview' | 'declared' | 'effective' | 'full';

export const DEFAULT_CLASS_STRUCTURE_SCOPE: ClassStructureScope = 'overview';

export const DEFAULT_MAX_INHERITED_METHODS = 40;

export type FormatClassStructureOptions = {
  scope?: ClassStructureScope;
  maxInheritedMethods?: number;
  /** Class-level Javadoc (first paragraph used when set). */
  classPurpose?: string | null;
};

function kindLabel(kind: ClassStructureKind): string {
  return kind;
}

function headerLines(result: GetClassStructureSuccess, purpose: string | null): string[] {
  const lines: string[] = [`${result.className} (${kindLabel(result.kind)})`];
  if (result.superclass) {
    lines.push(`  extends ${result.superclass}`);
  }
  if (result.interfaces.length > 0) {
    lines.push(`  implements ${result.interfaces.join(', ')}`);
  }
  if (result.typeParameters.length > 0) {
    lines.push(`  type parameters: ${result.typeParameters.join(', ')}`);
  }
  if (purpose) {
    lines.push('');
    lines.push(`Purpose: ${purpose}`);
  }
  return lines;
}

function formatFieldLine(f: GetClassStructureSuccess['fields'][number]): string {
  const vis = f.visibility === 'package' ? '' : `${f.visibility} `;
  const st = f.static ? 'static ' : '';
  const fin = f.final ? 'final ' : '';
  return `  ${vis}${st}${fin}${f.type} ${f.name}`;
}

export function formatClassStructureText(
  result: GetClassStructureSuccess,
  opts: FormatClassStructureOptions = {},
): string {
  const scope = opts.scope ?? DEFAULT_CLASS_STRUCTURE_SCOPE;
  const declared = result.methods.filter((m) => !m.inherited);
  const inherited = result.methods.filter((m) => m.inherited);
  const purposeFromClass = firstJavadocParagraph(
    opts.classPurpose ?? result.classPurpose ?? null,
  );

  const lines = headerLines(result, purposeFromClass);

  if (scope === 'overview') {
    lines.push('');
    if (declared.length > 0) {
      const names = declared.map((m) => m.name);
      const preview = names.length > 24 ? `${names.slice(0, 24).join(', ')}, …` : names.join(', ');
      lines.push(`Declared method names (${declared.length}): ${preview}`);
    } else {
      lines.push('Declared methods: (none)');
    }
    if (inherited.length > 0) {
      lines.push(
        `Inherited methods: ${inherited.length} (not listed — use scope=effective or get_method_signature for one method)`,
      );
    }
    if (result.fields.length > 0) {
      lines.push(`Fields: ${result.fields.length} (use scope=declared to list)`);
    }
    lines.push('');
    lines.push(formatProvenanceLine(result.provenance));
    lines.push(`sourceAvailable: ${result.sourceAvailable}`);
    return lines.join('\n');
  }

  if (scope === 'declared' || scope === 'effective') {
    if (result.fields.length > 0 && scope === 'declared') {
      lines.push('');
      lines.push(`Fields (${result.fields.length}):`);
      for (const f of result.fields) {
        lines.push(formatFieldLine(f));
      }
    }

    lines.push('');
    lines.push(`Methods — declared (${declared.length}):`);
    for (const m of declared) {
      lines.push(formatClassStructureMethodLine(m));
    }

    if (scope === 'effective' && inherited.length > 0) {
      const cap = opts.maxInheritedMethods ?? DEFAULT_MAX_INHERITED_METHODS;
      const shown = inherited.slice(0, cap);
      lines.push('');
      lines.push(`Methods — inherited (${shown.length} of ${inherited.length}):`);
      for (const m of shown) {
        lines.push(formatClassStructureMethodLine(m));
      }
      if (inherited.length > cap) {
        lines.push(
          `… ${inherited.length - cap} inherited method(s) omitted. Use get_method_signature(methodName) or scope with full=true for JSON.`,
        );
      }
    }

    lines.push('');
    lines.push(formatProvenanceLine(result.provenance));
    lines.push(`sourceAvailable: ${result.sourceAvailable}`);
    return lines.join('\n');
  }

  return formatClassStructureText(result, { ...opts, scope: 'overview' });
}

/** Full JSON path uses existing MCP payload; text summary for optional dual output. */
export function formatClassStructureSummaryLine(result: GetClassStructureSuccess): string {
  const inh = result.methods.filter((m: ClassStructureMethod) => m.inherited).length;
  return (
    `Structure for ${result.className}: ${result.methods.length} method(s) (${inh} inherited), ` +
    `${result.fields.length} field(s); sourceAvailable=${result.sourceAvailable}.`
  );
}
