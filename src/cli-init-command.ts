import type { Command } from 'commander';
import {
  installJvmsrcSkill,
  parseSkillAgent,
  parseSkillInstallScope,
  SKILL_AGENTS,
  type SkillAgent,
  type SkillInstallScope,
} from './cli-skill-install.js';
import { resolveProjectRoot } from './project-path.js';

export type InitSkillCliOptions = {
  agent?: string;
  scope: string;
  project: string;
  dir?: string;
  force: boolean;
  dryRun: boolean;
  quiet: boolean;
};

function agentDisplayName(agent: SkillAgent): string {
  switch (agent) {
    case 'cursor':
      return 'Cursor';
    case 'claude':
      return 'Claude Code';
  }
}

export function runInitSkillInstall(options: InitSkillCliOptions): void {
  if (options.agent === undefined || options.agent.trim().length === 0) {
    console.error(`Missing required option --agent <name>`);
    console.error(`Supported agents: ${SKILL_AGENTS.join(', ')}`);
    console.error('');
    console.error('Examples:');
    console.error('  jvmsrc init --agent cursor');
    console.error('  jvmsrc init --agent claude');
    console.error('  jvmsrc init --agent cursor --scope project -p /path/to/repo');
    process.exitCode = 1;
    return;
  }

  const agentParsed = parseSkillAgent(options.agent);
  if (typeof agentParsed !== 'string') {
    console.error(agentParsed.message);
    process.exitCode = 1;
    return;
  }

  const scopeParsed = parseSkillInstallScope(options.scope);
  if (typeof scopeParsed !== 'string') {
    console.error(scopeParsed.message);
    process.exitCode = 1;
    return;
  }

  const scope: SkillInstallScope = scopeParsed;
  const project = resolveProjectRoot(options.project);
  if (!project.ok) {
    console.error(project.message);
    process.exitCode = 1;
    return;
  }

  const result = installJvmsrcSkill({
    agent: agentParsed,
    scope,
    projectRoot: project.path,
    destDir: options.dir,
    overwrite: Boolean(options.force),
    dryRun: Boolean(options.dryRun),
  });

  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
    return;
  }

  if (options.quiet) {
    for (const e of result.entries) {
      console.log(e.path);
    }
    return;
  }

  const entry = result.entries[0];
  if (options.dryRun) {
    console.error(`Would install jvmsrc skill for ${agentDisplayName(agentParsed)}:`);
  } else {
    console.error(`Installed jvmsrc skill for ${agentDisplayName(agentParsed)}:`);
  }
  if (entry) {
    console.error(`  ${entry.path}`);
  }
  if (!options.dryRun) {
    console.error('\nRestart your AI tool (or open a new chat) so the skill is picked up.');
  }
}

export function registerInitCli(program: Command): void {
  program
    .command('init')
    .description('Install the bundled jvmsrc agent skill for your AI tool')
    .requiredOption('--agent <name>', `AI tool (${SKILL_AGENTS.join(' | ')})`)
    .option('--scope <scope>', 'user (default) or project — project is Cursor-only', 'user')
    .option('-p, --project <path>', 'Project root when --scope project', process.cwd())
    .option('-d, --dir <path>', 'Custom parent directory (advanced; installs <dir>/jvmsrc/SKILL.md)')
    .option('-f, --force', 'Overwrite existing SKILL.md', false)
    .option('--dry-run', 'Print destination without writing', false)
    .option('-q, --quiet', 'Only print the installed path', false)
    .action((options: InitSkillCliOptions) => {
      runInitSkillInstall(options);
    });
}
