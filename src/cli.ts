#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { buildJvmsrcMcpConfigPayload } from './cli-config-command.js';
import { registerDiagnosticsCli } from './diagnostics/cli-diagnostics-command.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';
import { writeCliFindInClassResult } from './cli-find-in-class-output.js';
import { writeCliGetResult } from './cli-get-output.js';
import { findInClassSource } from './find-in-class-source.js';
import { searchInArtifact } from './search-in-artifact.js';
import { createCliProgressReporter } from './cli-progress.js';
import { getClassSource } from './get-class-source.js';
import { mergeSourceExcerptInputs } from './source-excerpt.js';
import { resolveProjectRoot } from './project-path.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import { formatResolutionSummaryText } from './text-format/format-resolve.js';

/** `jvmsrc com.example.Foo` → same as `jvmsrc get com.example.Foo` */
function injectImplicitGetSubcommand(): void {
  const subcommands = new Set([
    'get',
    'find-in-class',
    'search-in-artifact',
    'mcp',
    'config',
    'resolve',
    'diagnostics',
  ]);
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
  .option('-v, --verbose', 'Stream Gradle stderr during resolution and sources JAR fetch', false)
  .option('--json', 'Print one JSON object on stdout for success or failure (agent-friendly)', false)
  .option(
    '--method <name>',
    'Include only this method/constructor in output (<init> for constructors); repeat for multiple',
    (value: string, previous: string[] | undefined) => {
      const list = previous ?? [];
      list.push(value);
      return list;
    },
  )
  .option('--start-line <n>', '1-based start line for excerpt (requires --end-line)', (v) => parseInt(v, 10))
  .option('--end-line <n>', '1-based end line for excerpt (requires --start-line)', (v) => parseInt(v, 10))
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
        verbose?: boolean;
        json?: boolean;
        method?: string[];
        startLine?: number;
        endLine?: number;
      },
    ) => {
      const json = Boolean(options.json);
      const showProgress = !options.quiet;
      const verboseGradle = Boolean(options.verbose);
      const root = resolveProjectRoot(options.project);
      if (!root.ok) {
        const d = recordFailureDiagnostic({
          operation: 'cli_get',
          publicCode: 'INVALID_PROJECT_ROOT',
          message: root.message,
          projectRoot: options.project,
          buildSystem: null,
          input: { className },
        });
        const extra =
          d.diagnosticId !== undefined ? { diagnosticId: d.diagnosticId, ...(d.hint ? { hint: d.hint } : {}) } : {};
        if (json) {
          console.log(
            JSON.stringify({
              error: true,
              code: 'INVALID_PROJECT_ROOT',
              message: root.message,
              ...extra,
            }),
          );
        } else {
          console.error(root.message);
        }
        process.exitCode = 1;
        return;
      }
      const cli =
        showProgress || verboseGradle ? { progress: showProgress, verboseGradle } : undefined;
      const methodNames = mergeSourceExcerptInputs(options.method);
      const result = await getClassSource(className, {
        projectRoot: root.path,
        modulePath: options.module,
        configuration: options.configuration,
        includeTest: Boolean(options.includeTest),
        forceRefresh: Boolean(options.forceRefresh),
        cli,
        excerpt:
          methodNames !== undefined || options.startLine !== undefined || options.endLine !== undefined
            ? {
                methodNames,
                startLine: options.startLine,
                endLine: options.endLine,
              }
            : undefined,
      });
      writeCliGetResult(result, { quiet: Boolean(options.quiet), json });
    },
  );

program
  .command('resolve')
  .description(
    'Resolve Gradle dependencies (compact text summary by default; --full or --json for ResolutionOutput JSON)',
  )
  .option('-p, --project <path>', 'Path to the project root', process.cwd())
  .option('--force-refresh', 'Bypass resolution cache and re-invoke Gradle')
  .option('-v, --verbose', 'Stream Gradle stderr during resolution', false)
  .option('--full', 'Print full ResolutionOutput JSON (same as --json)', false)
  .option('--json', 'Alias for --full', false)
  .action(async (options: { project: string; forceRefresh?: boolean; verbose?: boolean; full?: boolean; json?: boolean }) => {
    const root = resolveProjectRoot(options.project);
    if (!root.ok) {
      console.error(root.message);
      process.exitCode = 1;
      return;
    }
    const progress = createCliProgressReporter(true);
    const verbose = Boolean(options.verbose);
    try {
      const result = await resolveWithResolutionCache(root.path, {
        forceRefresh: Boolean(options.forceRefresh),
        diagnosticOperation: 'cli_resolve',
        resolveOptions: verbose
          ? { inheritGradleStderr: true }
          : {
              onBeforeGradle: () => progress.update('Resolving dependencies (Gradle)…'),
              onAfterGradle: () => progress.finishPhase(),
            },
      });
      if (!result.ok) {
        console.error(result.message);
        if (result.stderr) {
          console.error(result.stderr);
        }
        if (result.hint) {
          console.error(result.hint);
        }
        process.exitCode = 1;
        return;
      }
      const printFull = Boolean(options.full || options.json);
      if (printFull) {
        console.log(JSON.stringify(result.output, null, 2));
      } else {
        console.log(formatResolutionSummaryText(result.output));
      }
    } finally {
      progress.finalize();
    }
  });

program
  .command('find-in-class')
  .description(
    'Search resolved Java source for a class (literal substring by default; optional regex)',
  )
  .argument('<className>', 'e.g. com.example.MyClass')
  .argument('<query>', 'substring or regex to find')
  .option('-p, --project <path>', 'Path to the project root', process.cwd())
  .option('-m, --module <module>', 'Gradle module path (e.g. :core:utils)')
  .option('-c, --configuration <name>', 'Resolved configuration name')
  .option('--include-test', 'Use testCompileClasspath when configuration omitted', false)
  .option('--force-refresh', 'Bypass resolution cache and re-invoke Gradle', false)
  .option('-q, --quiet', 'Disable progress labels on stderr', false)
  .option('-v, --verbose', 'Stream Gradle stderr during resolution', false)
  .option('--json', 'Print one JSON object on stdout (full structured result)', false)
  .option('--full', 'Alias for --json on find-in-class', false)
  .option('--context-lines <n>', 'Context lines above/below each hit (default 3)', (v) => parseInt(v, 10))
  .option('--max-hits <n>', 'Maximum hits to return (default 20, max 100)', (v) => parseInt(v, 10))
  .option('--regex', 'Treat query as a JavaScript RegExp pattern', false)
  .action(
    async (
      className: string,
      query: string,
      options: {
        project: string;
        module?: string;
        configuration?: string;
        includeTest?: boolean;
        forceRefresh?: boolean;
        quiet?: boolean;
        verbose?: boolean;
        json?: boolean;
        contextLines?: number;
        maxHits?: number;
        regex?: boolean;
      },
    ) => {
      const root = resolveProjectRoot(options.project);
      if (!root.ok) {
        if (options.json) {
          console.log(
            JSON.stringify({ error: true, code: 'INVALID_PROJECT_ROOT', message: root.message }),
          );
        } else {
          console.error(root.message);
        }
        process.exitCode = 1;
        return;
      }
      const showProgress = !options.quiet;
      const verboseGradle = Boolean(options.verbose);
      const cli =
        showProgress || verboseGradle ? { progress: showProgress, verboseGradle } : undefined;
      const result = await findInClassSource(className, {
        projectRoot: root.path,
        modulePath: options.module,
        configuration: options.configuration,
        includeTest: Boolean(options.includeTest),
        forceRefresh: Boolean(options.forceRefresh),
        query,
        contextLines: options.contextLines,
        maxHits: options.maxHits,
        regex: Boolean(options.regex),
        cli,
      });
      writeCliFindInClassResult(result, { json: Boolean(options.json) });
    },
  );

program
  .command('search-in-artifact')
  .description(
    'Search for a literal or regex query across all classes in one resolved dependency JAR',
  )
  .argument('<query>', 'substring or regex to find')
  .option('-p, --project <path>', 'Path to the project root', process.cwd())
  .option('-g, --group <group>', 'Maven group ID (required with --name)')
  .option('-n, --name <name>', 'Maven artifact name (required with --group)')
  .option('--version <version>', 'Maven version (optional with coordinates)')
  .option('--jar-path <path>', 'Absolute JAR path from resolve output (alternative to coordinates)')
  .option('-m, --module <module>', 'Gradle module path (e.g. :core:utils)')
  .option('-c, --configuration <name>', 'Resolved configuration name')
  .option('--include-test', 'Use testCompileClasspath when configuration omitted', false)
  .option('--force-refresh', 'Bypass resolution cache and re-invoke Gradle', false)
  .option('--regex', 'Treat query as a JavaScript RegExp pattern', false)
  .option('--context-lines <n>', 'Context lines above/below each hit (default 3)', (v) => parseInt(v, 10))
  .option('--max-hits <n>', 'Maximum total hits across all classes (default 20, max 100)', (v) => parseInt(v, 10))
  .option('--max-classes <n>', 'Maximum classes to scan (default 500)', (v) => parseInt(v, 10))
  .option('--json', 'Print one JSON object on stdout', false)
  .action(
    async (
      query: string,
      options: {
        project: string;
        group?: string;
        name?: string;
        version?: string;
        jarPath?: string;
        module?: string;
        configuration?: string;
        includeTest?: boolean;
        forceRefresh?: boolean;
        regex?: boolean;
        contextLines?: number;
        maxHits?: number;
        maxClasses?: number;
        json?: boolean;
      },
    ) => {
      const useJson = Boolean(options.json);
      const root = resolveProjectRoot(options.project);
      if (!root.ok) {
        if (useJson) {
          console.log(
            JSON.stringify({ error: true, code: 'INVALID_PROJECT_ROOT', message: root.message }),
          );
        } else {
          console.error(root.message);
        }
        process.exitCode = 1;
        return;
      }

      const hasCoordinates = Boolean(options.group) && Boolean(options.name);
      const hasJarPath = Boolean(options.jarPath);

      if (!hasCoordinates && !hasJarPath) {
        const msg = 'Provide either --group and --name (Maven coordinates) or --jar-path.';
        if (useJson) {
          console.log(JSON.stringify({ error: true, code: 'INVALID_SELECTOR', message: msg }));
        } else {
          console.error(msg);
        }
        process.exitCode = 1;
        return;
      }

      const result = await searchInArtifact({
        projectRoot: root.path,
        selector: {
          coordinates: hasCoordinates
            ? { group: options.group!, name: options.name!, version: options.version }
            : undefined,
          jarPath: options.jarPath,
        },
        query,
        regex: Boolean(options.regex),
        contextLines: options.contextLines,
        maxHits: options.maxHits,
        maxClasses: options.maxClasses,
        modulePath: options.module,
        configuration: options.configuration,
        includeTest: Boolean(options.includeTest),
        forceRefresh: Boolean(options.forceRefresh),
      });

      if (useJson) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok || (result.found && result.hitCount === 0)) {
          process.exitCode = 1;
        }
        return;
      }

      if (!result.ok) {
        console.error(`search-in-artifact: ${result.error.message}`);
        process.exitCode = 1;
        return;
      }

      if (!result.found) {
        console.log(`search-in-artifact: ${result.message}`);
        if (result.candidates && result.candidates.length > 0) {
          console.log('Candidates:');
          for (const c of result.candidates) {
            console.log(`  ${[c.group, c.name, c.version].filter(Boolean).join(':')}  (${c.jarPath ?? 'no jar'})`);
          }
        }
        process.exitCode = 1;
        return;
      }

      if (result.hitCount === 0) {
        const { formatSearchInArtifactNoHitsText } = await import('./text-format/format-search-in-artifact.js');
        console.log(formatSearchInArtifactNoHitsText(result));
        return;
      }

      const { formatSearchInArtifactText } = await import('./text-format/format-search-in-artifact.js');
      console.log(formatSearchInArtifactText(result));
    },
  );

registerDiagnosticsCli(program);

program
  .command('config')
  .description('Print paste-ready MCP server JSON (Cursor / Claude Desktop / Windsurf) plus environment hints')
  .option('-p, --project <path>', 'Project root for hints (Gradle wrapper detection)', process.cwd())
  .action((options: { project: string }) => {
    const root = resolveProjectRoot(options.project);
    if (!root.ok) {
      console.error(root.message);
      process.exitCode = 1;
      return;
    }
    const payload = buildJvmsrcMcpConfigPayload(root.path);
    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command('mcp')
  .description('Run as an MCP server')
  .action(async () => {
    const { startMcpServer } = await import('./mcp.js');
    await startMcpServer();
  });

program.parse();
