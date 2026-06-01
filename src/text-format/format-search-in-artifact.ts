import type { SearchInArtifactResult } from '../search-in-artifact.js';

function artifactLabel(artifact: { group: string; name: string; version: string | null }): string {
  return [artifact.group, artifact.name, artifact.version].filter(Boolean).join(':');
}

export function formatSearchInArtifactText(
  result: Extract<SearchInArtifactResult, { ok: true; found: true }>,
): string {
  const lines: string[] = [
    `search_in_artifact: ${result.totalMatches} match(es) for ${JSON.stringify(result.query)} in ${artifactLabel(result.artifact)}`,
    `Scanned ${result.classesScanned} class(es) — ${result.hits.length} class(es) with hits`,
  ];

  if (result.truncated) {
    lines.push(`(truncated — showing first ${result.hitCount} hit(s))`);
  }
  lines.push('');

  for (const cls of result.hits) {
    lines.push(`## ${cls.className}${cls.sourceAvailable ? '' : '  [decompiled]'}`);
    for (const h of cls.hits) {
      lines.push(`  ${h.line}:${h.column}  ${h.matchedText.trim()}`);
      const before = h.contextBefore.filter((l) => l.length > 0);
      const after = h.contextAfter.filter((l) => l.length > 0);
      if (before.length > 0) {
        lines.push(`    ^ ${before[before.length - 1]!.trimEnd()}`);
      }
      if (after.length > 0) {
        lines.push(`    v ${after[0]!.trimEnd()}`);
      }
    }
    if (cls.totalMatches > cls.hits.length) {
      lines.push(`  … ${cls.totalMatches - cls.hits.length} more match(es) in this class`);
    }
    lines.push('');
  }

  lines.push(`Use full=true for JSON hits with full context arrays.`);
  return lines.join('\n');
}

export function formatSearchInArtifactNoHitsText(
  result: Extract<SearchInArtifactResult, { ok: true; found: true }>,
): string {
  return (
    `search_in_artifact: no matches for ${JSON.stringify(result.query)} in ${artifactLabel(result.artifact)} ` +
    `(${result.classesScanned} class(es) scanned)`
  );
}

export function formatSearchInArtifactNotFoundText(
  result: Extract<SearchInArtifactResult, { ok: true; found: false }>,
): string {
  if (result.code === 'ARTIFACT_AMBIGUOUS' && result.candidates && result.candidates.length > 0) {
    const candidateLines = result.candidates.map((c) => `  ${artifactLabel(c)}  (${c.jarPath ?? 'no jar'})`);
    return [`search_in_artifact: ${result.message}`, 'Candidates:', ...candidateLines].join('\n');
  }
  return `search_in_artifact: ${result.message}`;
}
