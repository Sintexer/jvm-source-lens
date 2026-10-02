import type { ResolutionOutput } from '../resolvers/resolution-output.js';

const MAX_ARTIFACT_LINES = 60;
const MAX_MODULES_PER_VERSION = 25;

/**
 * Lists `group:name` → versions for artifacts matching every whitespace-separated token of `query`
 * (case-insensitive, over `group:name:version`). Flags libraries that resolve to more than one version.
 *
 * `modules` controls verbosity so agents never flood their context by accident:
 * - omitted: versions with module counts only;
 * - `"all"`: every module name per version;
 * - otherwise a comma-separated list of module paths/prefixes (e.g. `:services`): only matching modules
 *   are considered and their names are listed (capped per version).
 */
export function formatArtifactVersionsText(output: ResolutionOutput, query: string, modules?: string): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const modulesArg = modules?.trim() ?? '';
  const listAll = modulesArg === 'all';
  const filters = listAll ? [] : modulesArg.split(',').map((f) => f.trim()).filter((f) => f.length > 0);
  const matchesFilter = (name: string): boolean =>
    filters.length === 0 || filters.some((f) => name === f || name.startsWith(`${f}:`));
  const listNames = listAll || filters.length > 0;

  const byLib = new Map<string, Map<string, Set<string>>>();
  for (const mod of output.modules) {
    if (!matchesFilter(mod.name)) {
      continue;
    }
    for (const cfg of mod.configurations) {
      for (const a of cfg.artifacts) {
        if (a.origin === 'interproject') {
          continue;
        }
        const version = a.version ?? '(no version)';
        const hay = `${a.group}:${a.name}:${version}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) {
          continue;
        }
        const lib = `${a.group}:${a.name}`;
        const versions = byLib.get(lib) ?? new Map<string, Set<string>>();
        const mods = versions.get(version) ?? new Set<string>();
        mods.add(mod.name);
        versions.set(version, mods);
        byLib.set(lib, versions);
      }
    }
  }
  const lines: string[] = [`Artifacts matching ${JSON.stringify(query)} (${byLib.size}):`];
  if (byLib.size === 0) {
    lines.push('  (none) — try a shorter query, e.g. the library name.');
    return lines;
  }
  const describe = (mods: Set<string>): string => {
    const count = `${mods.size} module${mods.size === 1 ? '' : 's'}`;
    if (!listNames) {
      return count;
    }
    const names = [...mods].sort();
    const cap = listAll ? names.length : MAX_MODULES_PER_VERSION;
    const shown = names.slice(0, cap).join(', ');
    return names.length > cap ? `${count}: ${shown}, … +${names.length - cap} more` : `${count}: ${shown}`;
  };
  const libs = [...byLib.keys()].sort();
  for (const lib of libs.slice(0, MAX_ARTIFACT_LINES)) {
    const versions = byLib.get(lib)!;
    const detail = [...versions.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([v, mods]) => `${v} (${describe(mods)})`);
    lines.push(`  ${lib}  ${versions.size > 1 ? `⚠ ${versions.size} versions: ` : ''}${detail.join('; ')}`);
  }
  if (libs.length > MAX_ARTIFACT_LINES) {
    lines.push(`  … ${libs.length - MAX_ARTIFACT_LINES} more librar(ies); narrow the query.`);
  }
  if (!listNames) {
    lines.push('Pass modules (e.g. ":services" or "all") to list which modules use each version.');
  }
  return lines;
}

export type ResolutionSummaryOptions = {
  /** Lists matching artifact versions below the module summary. */
  artifactQuery?: string;
  /** Module listing level for the artifact query: omitted = counts only, `all`, or module path filter(s). */
  artifactModules?: string;
  /** Wording of the trailing hint: the CLI has `resolve --full`; MCP agents get the `query` hint. */
  audience?: 'cli' | 'mcp';
};

export function formatResolutionSummaryText(
  output: ResolutionOutput,
  opts: ResolutionSummaryOptions = {},
): string {
  const audience = opts.audience ?? 'cli';
  if (opts.artifactQuery !== undefined && opts.artifactQuery.trim().length > 0) {
    // The query is the point of the call: skip the per-module/configuration summary (huge on big builds).
    return formatArtifactVersionsText(output, opts.artifactQuery, opts.artifactModules).join('\n');
  }
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
      lines.push(`  … ${output.errors.length - 20} more`);
    }
  }

  lines.push('');
  if (audience === 'mcp') {
    lines.push('Pass query (e.g. "jackson") to list matching artifact versions and spot version conflicts.');
  } else {
    lines.push('Use jvmsrc resolve --full for complete ResolutionOutput JSON.');
  }
  return lines.join('\n');
}
