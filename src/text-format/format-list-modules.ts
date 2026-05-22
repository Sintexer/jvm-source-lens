import type { ListModulesPayloadData } from '../list-modules-payload.js';

export function formatListModulesText(data: ListModulesPayloadData): string {
  const lines: string[] = [
    `Modules (${data.modules.length}) — resolved ${data.resolvedAt}`,
    `Project: ${data.projectRoot}`,
    '',
  ];
  for (const m of data.modules) {
    const artifactTotal = m.configurations.reduce((n, c) => n + c.artifactCount, 0);
    lines.push(`${m.name}  ${m.path}  (${artifactTotal} artifact(s) across ${m.configurations.length} configuration(s))`);
    for (const c of m.configurations) {
      lines.push(`  ${c.name}: ${c.artifactCount} (${c.directArtifactCount} direct)`);
    }
  }
  if (data.resolutionWarningCount > 0) {
    lines.push('');
    lines.push(`Resolution warnings: ${data.resolutionWarningCount} (use resolve_dependencies full=true for errors[])`);
  }
  lines.push('');
  lines.push('Use full=true for JSON module objects.');
  return lines.join('\n');
}
