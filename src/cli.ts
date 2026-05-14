#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { resolveProjectRoot } from './project-path.js';

/** `jvmsrc com.example.Foo` → same as `jvmsrc get com.example.Foo` */
function injectImplicitGetSubcommand(): void {
  const subcommands = new Set(['get', 'mcp', 'config']);
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    return;
  }
  const first = raw[0];
  if (!first || subcommands.has(first) || first.startsWith('-')) {
    return;
  }
  process.argv.splice(2, 0, 'get');
}

injectImplicitGetSubcommand();

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };

const program = new Command();

program
  .name('jvmsrc')
  .description('JVM Source Lens — resolve JVM build-tool dependencies and extract sources (Gradle first)')
  .version(pkg.version ?? '0.0.0');

program
  .command('get')
  .description('Look up a fully-qualified class name (not yet implemented)')
  .argument('<className>', 'e.g. com.example.MyClass')
  .option('-p, --project <path>', 'Path to the project root', process.cwd())
  .option('-m, --module <module>', 'Submodule path (e.g. :core:utils)')
  .action(async (className: string, options: { project: string; module?: string }) => {
    const root = resolveProjectRoot(options.project);
    if (!root.ok) {
      console.error(root.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Searching for class: ${className}`);
    console.log(`Project root: ${root.path}`);
    if (options.module) {
      console.log(`Module: ${options.module}`);
    }
  });

program
  .command('mcp')
  .description('Run as an MCP server')
  .action(async () => {
    const { startMcpServer } = await import('./mcp.js');
    await startMcpServer();
  });

program.parse();
