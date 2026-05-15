#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { writeCliGetResult } from './cli-get-output.js';
import { getClassSource } from './get-class-source.js';
import { resolveProjectRoot } from './project-path.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

/** `jvmsrc com.example.Foo` → same as `jvmsrc get com.example.Foo` */
function injectImplicitGetSubcommand(): void {
  const subcommands = new Set(['get', 'mcp', 'config', 'resolve']);
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
  .description(
    'Print Java source for a fully-qualified class (inter-project submodule source, sources JAR, or CFR fallback)',
  )
  .argument('<className>', 'e.g. com.example.MyClass')
  .option('-p, --project <path>', 'Path to the project root', process.cwd())
  .option('-m, --module <module>', 'Gradle module path (e.g. :core:utils); defaults to root')
  .option(
    '-c, --configuration <name>',
    'Resolved configuration name (default: compileClasspath, or testCompileClasspath with --include-test)',
  )
  .option('--include-test', 'When --configuration is omitted, use testCompileClasspath', false)
  .option('--force-refresh', 'Bypass resolution cache and re-invoke Gradle', false)
  .option('-q, --quiet', 'On success, write only Java source to stdout (no metadata JSON on stderr)', false)
  .option('--json', 'Print one JSON object on stdout for success or failure (agent-friendly)', false)
  .action(
    async (
      className: string,
      options: {
        project: string;
        module?: string;
        configuration?: string;
        includeTest?: boolean;
        forceRefresh?: boolean;
        quiet?: boolean;
        json?: boolean;
      },
    ) => {
      const json = Boolean(options.json);
      const root = resolveProjectRoot(options.project);
      if (!root.ok) {
        if (json) {
          console.log(
            JSON.stringify({
              error: true,
              code: 'INVALID_PROJECT_ROOT',
              message: root.message,
            }),
          );
        } else {
          console.error(root.message);
        }
        process.exitCode = 1;
        return;
      }
      const result = await getClassSource(className, {
        projectRoot: root.path,
        modulePath: options.module,
        configuration: options.configuration,
        includeTest: Boolean(options.includeTest),
        forceRefresh: Boolean(options.forceRefresh),
      });
      writeCliGetResult(result, { quiet: Boolean(options.quiet), json });
    },
  );

program
  .command('resolve')
  .description('Resolve Gradle dependencies and print ResolutionOutput JSON (uses resolution cache unless --force-refresh)')
  .option('-p, --project <path>', 'Path to the project root', process.cwd())
  .option('--force-refresh', 'Bypass resolution cache and re-invoke Gradle')
  .action(async (options: { project: string; forceRefresh?: boolean }) => {
    const root = resolveProjectRoot(options.project);
    if (!root.ok) {
      console.error(root.message);
      process.exitCode = 1;
      return;
    }
    const result = await resolveWithResolutionCache(root.path, {
      forceRefresh: Boolean(options.forceRefresh),
    });
    if (!result.ok) {
      console.error(result.message);
      if (result.stderr) {
        console.error(result.stderr);
      }
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result.output, null, 2));
  });

program
  .command('mcp')
  .description('Run as an MCP server')
  .action(async () => {
    const { startMcpServer } = await import('./mcp.js');
    await startMcpServer();
  });

program.parse();
