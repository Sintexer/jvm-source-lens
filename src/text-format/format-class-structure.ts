import type { ClassStructureKind, ClassStructureMethod, GetClassStructureSuccess } from '../class-structure/types.js';
import { CONSTRUCTOR_METHOD_NAME } from '../copy/hints.js';
import { firstJavadocParagraph } from './truncate.js';
import { formatCompactModifiers } from './format-compact-modifiers.js';
import { formatClassStructureMethodLine } from './format-method-line.js';
import { formatProvenanceLine } from './format-provenance.js';

export type ClassStructureScope = 'overview' | 'declared' | 'effective' | 'full';

export const DEFAULT_CLASS_STRUCTURE_SCOPE: ClassStructureScope = 'overview';

export const DEFAULT_MAX_INHERITED_METHODS = 40;

/** Overview lists fields when the type is field-heavy (constants-style). */
export const FIELD_HEAVY_MIN_FIELDS = 8;
export const FIELD_HEAVY_MAX_NON_CTOR_METHODS = 2;
export const OVERVIEW_FIELD_LIST_CAP = 40;

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
  const mods = formatCompactModifiers({
    visibility: f.visibility,
    static: f.static,
    final: f.final,
  });
  return `  ${mods}${f.type} ${f.name}`;
}

function isConstructorMethod(m: ClassStructureMethod): boolean {
  return m.jvmMethodName === CONSTRUCTOR_METHOD_NAME;
}

/**
 * Field-heavy types (e.g. constants classes): many fields, few non-constructor declared methods.
 * Overview then lists fields instead of only a count.
 */
export function isFieldHeavyOverview(result: GetClassStructureSuccess): boolean {
  const declared = result.methods.filter((m) => !m.inherited);
  const nonCtor = declared.filter((m) => !isConstructorMethod(m));
  return result.fields.length >= FIELD_HEAVY_MIN_FIELDS && nonCtor.length <= FIELD_HEAVY_MAX_NON_CTOR_METHODS;
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
      if (isFieldHeavyOverview(result)) {
        const shown = result.fields.slice(0, OVERVIEW_FIELD_LIST_CAP);
        lines.push(`Fields (${result.fields.length}):`);
        for (const f of shown) {
          lines.push(formatFieldLine(f));
        }
        if (result.fields.length > OVERVIEW_FIELD_LIST_CAP) {
          lines.push(
            `… ${result.fields.length - OVERVIEW_FIELD_LIST_CAP} more field(s); use scope=declared to list all.`,
          );
        }
      } else {
        lines.push(`Fields: ${result.fields.length} (use scope=declared to list)`);
      }
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
