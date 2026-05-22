import type { ClassSearchHit } from '../class-search/types.js';

export function formatSearchClassesText(args: {
  query: string;
  totalMatches: number;
  hits: ClassSearchHit[];
  limit: number;
}): string {
  const lines: string[] = [
    `search_classes: ${args.totalMatches} match(es) for ${JSON.stringify(args.query)}; showing ${args.hits.length} (limit ${args.limit})`,
    '',
  ];
  for (const h of args.hits) {
    const coord = `${h.coordinates.group}:${h.coordinates.name}:${h.coordinates.version ?? ''}`;
    const loc =
      h.origin === 'interproject'
        ? h.interprojectModuleName ?? h.moduleName
        : h.jarPath ?? h.moduleRoot ?? '';
    lines.push(`${h.score.toFixed(2)}  ${h.className}  (${h.origin}, ${coord}${loc ? `, ${loc}` : ''})`);
  }
  if (args.hits.length < args.totalMatches) {
    lines.push('');
    lines.push(`… ${args.totalMatches - args.hits.length} more match(es). Raise limit or narrow query.`);
  }
  lines.push('');
  lines.push('Use full=true for JSON hits and indexMeta.');
  return lines.join('\n');
}
