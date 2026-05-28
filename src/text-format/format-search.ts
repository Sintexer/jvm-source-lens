import type { ClassSearchIncludeSection } from '../class-search/project-search-hit.js';
import { deriveLibName, wantsSearchInclude } from '../class-search/project-search-hit.js';
import type { ClassSearchHit } from '../class-search/types.js';

function formatHitSuffix(hit: ClassSearchHit, include?: ClassSearchIncludeSection[]): string {
  const parts: string[] = [];
  if (wantsSearchInclude(include, 'all') || wantsSearchInclude(include, 'score')) {
    parts.push(`score=${hit.score.toFixed(2)}`);
  }
  if (wantsSearchInclude(include, 'all') || wantsSearchInclude(include, 'simpleName')) {
    parts.push(`simple=${hit.simpleName}`);
  }
  if (wantsSearchInclude(include, 'all') || wantsSearchInclude(include, 'origin')) {
    parts.push(`origin=${hit.origin}`);
  }
  if (wantsSearchInclude(include, 'all') || wantsSearchInclude(include, 'coordinates')) {
    const c = hit.coordinates;
    parts.push(`${c.group}:${c.name}:${c.version ?? ''}`);
  }
  if (wantsSearchInclude(include, 'all') || wantsSearchInclude(include, 'scope')) {
    parts.push(`${hit.moduleName}/${hit.configurationName}`);
  }
  if (wantsSearchInclude(include, 'all') || wantsSearchInclude(include, 'location')) {
    const loc =
      hit.origin === 'interproject'
        ? (hit.interprojectModuleName ?? hit.moduleRoot ?? hit.moduleName)
        : (hit.jarPath ?? hit.moduleRoot ?? '');
    if (loc) {
      parts.push(loc);
    }
  }
  return parts.length > 0 ? `  (${parts.join(', ')})` : '';
}

export function formatSearchClassesText(args: {
  query: string;
  totalMatches: number;
  hits: ClassSearchHit[];
  limit: number;
  include?: ClassSearchIncludeSection[];
}): string {
  const lines: string[] = [
    `search_classes: ${args.totalMatches} match(es) for ${JSON.stringify(args.query)}; showing ${args.hits.length} (limit ${args.limit})`,
    '',
  ];
  for (const h of args.hits) {
    const libName = deriveLibName(h);
    const suffix = formatHitSuffix(h, args.include);
    lines.push(`${h.className}  ${libName}${suffix}`);
  }
  if (args.hits.length < args.totalMatches) {
    lines.push('');
    lines.push(`… ${args.totalMatches - args.hits.length} more match(es). Raise limit or narrow query.`);
  }
  lines.push('');
  lines.push('Use full=true for JSON. Optional include: score, coordinates, location, scope, indexMeta, all.');
  return lines.join('\n');
}
