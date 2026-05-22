import type { ResolutionOutput } from '../resolvers/resolution-output.js';

export function formatResolutionSummaryText(output: ResolutionOutput): string {
  const lines: string[] = [
    `Resolved at ${output.resolvedAt} (${output.buildSystem.type} ${output.buildSystem.version}, wrapper=${output.buildSystem.wrapper})`,
    `Project: ${output.projectRoot}`,
    `Modules (${output.modules.length}):`,
  ];

  for (const mod of output.modules) {
    lines.push(`  ${mod.name}  ${mod.path}`);
    for (const cfg of mod.configurations) {
      const direct = cfg.artifacts.filter((a) => a.direct).length;
      lines.push(`    ${cfg.name} (${cfg.scope}): ${cfg.artifacts.length} artifact(s), ${direct} direct`);
    }
  }

  if (output.errors.length > 0) {
    lines.push('');
    lines.push(`Resolution warnings (${output.errors.length}):`);
    for (const e of output.errors.slice(0, 20)) {
      const cfg = e.configuration ? ` / ${e.configuration}` : '';
      lines.push(`  [${e.fatal ? 'fatal' : 'warn'}] ${e.module}${cfg}: ${e.message}`);
    }
    if (output.errors.length > 20) {
      lines.push(`  … ${output.errors.length - 20} more (use full=true for full errors[])`);
    }
  }

  lines.push('');
  lines.push('Use full=true (MCP) or jvmsrc resolve --full for complete ResolutionOutput JSON.');
  return lines.join('\n');
}
