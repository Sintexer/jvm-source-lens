export type CompactModifierVisibility = 'public' | 'protected' | 'package' | 'private';

export type CompactModifiersInput = {
  visibility: CompactModifierVisibility;
  static?: boolean;
  final?: boolean;
  abstract?: boolean;
};

/**
 * Compact Java modifier prefix for MCP/CLI text.
 * Legend: P=public, p=private, prot=protected, pack=package-private; s=static, a=abstract, f=final.
 * Returns "" or a blob ending in a trailing space (e.g. "Psf ", "prot a ", "pack sf ").
 */
export function formatCompactModifiers(opts: CompactModifiersInput): string {
  let vis = '';
  switch (opts.visibility) {
    case 'public':
      vis = 'P';
      break;
    case 'protected':
      vis = 'prot';
      break;
    case 'private':
      vis = 'p';
      break;
    case 'package':
      vis = 'pack';
      break;
  }

  const flags =
    (opts.static ? 's' : '') + (opts.abstract ? 'a' : '') + (opts.final ? 'f' : '');

  if (!vis && !flags) {
    return '';
  }
  if (!flags) {
    return `${vis} `;
  }
  // Single-letter visibility (P/p) concatenates tightly; multi-letter gets a space before flags.
  if (vis.length === 1) {
    return `${vis}${flags} `;
  }
  return `${vis} ${flags} `;
}
