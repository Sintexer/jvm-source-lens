/**
 * Manual eval harness for the jvmsrc MCP server. Drives Claude Code headlessly (`claude -p`, your
 * existing login, no API key) against test/evals/project, records transcripts, and prints the metrics
 * from the UX plan. NOT part of CI: it spends tokens and needs network + Gradle.
 *
 *   bun run eval                           # all 40 prompts, jvmsrc + Read/Grep/Glob/Bash
 *   bun run eval --filter negative         # a category or prompt id; comma-separate several (d01,i05,m03)
 *   bun run eval --mode competing          # also allow WebSearch/WebFetch
 *   bun run eval --with-hook               # install docs/hooks/block-jvm-fallbacks.mjs
 *   bun run eval --rescore test/evals/results/<run>   # re-score saved transcripts, no model calls
 *   bun run eval --dry-run                 # print the commands only
 *
 * See test/evals/README.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  TARGETS,
  aggregate,
  aggregateByCategory,
  parseTranscript,
  scorePrompt,
  type EvalPrompt,
  type PromptScore,
} from './scoring.js';

const repoRoot = path.resolve(import.meta.dir, '../..');
const evalDir = import.meta.dir;

const { values: args } = parseArgs({
  options: {
    model: { type: 'string' },
    filter: { type: 'string' },
    limit: { type: 'string' },
    mode: { type: 'string', default: 'default' },
    'with-hook': { type: 'boolean', default: false },
    budget: { type: 'string', default: '0.50' },
    timeout: { type: 'string', default: '240' },
    concurrency: { type: 'string', default: '1' },
    project: { type: 'string', default: path.join(evalDir, 'project') },
    out: { type: 'string' },
    rescore: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (args.mode !== 'default' && args.mode !== 'competing') {
  throw new Error(`--mode must be "default" or "competing", got ${JSON.stringify(args.mode)}`);
}

const allPrompts = JSON.parse(readFileSync(path.join(evalDir, 'prompts.json'), 'utf8')) as EvalPrompt[];
const filters = (args.filter ?? '').split(',').map((f) => f.trim()).filter(Boolean);
let prompts = allPrompts.filter((p) => filters.length === 0 || filters.includes(p.id) || filters.includes(p.category));
if (args.limit) {
  prompts = prompts.slice(0, Number(args.limit));
}
if (prompts.length === 0) {
  throw new Error(`No prompts match --filter ${args.filter}`);
}

const outDir =
  args.rescore ?? args.out ?? path.join(evalDir, 'results', new Date().toISOString().replace(/[:.]/g, '-'));
const logDir = path.join(outDir, 'server-logs');

// Fallback tools are deliberately allowed: we want to see whether the agent prefers jvmsrc, not force it.
const READ_ONLY_BASH = ['javap', 'unzip', 'jar', 'ls', 'cat', 'find', 'grep', 'head', 'tail', 'wc'].map((c) => `Bash(${c} *)`);
const allowedTools = [
  'mcp__jvmsrc__*',
  'Read',
  'Grep',
  'Glob',
  ...READ_ONLY_BASH,
  ...(args.mode === 'competing' ? ['WebSearch', 'WebFetch'] : []),
].join(',');

function buildMcpConfig(): string {
  const file = path.join(outDir, 'mcp-config.json');
  const config = {
    mcpServers: {
      jvmsrc: {
        command: process.execPath,
        args: [path.join(repoRoot, 'src/cli.ts'), 'mcp'],
        env: { JVMSRC_CALL_LOG: '1', JVMSRC_LOG_DIR: logDir },
      },
    },
  };
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

function claudeArgs(prompt: string, mcpConfig: string): string[] {
  const a = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    '--setting-sources',
    'project',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    allowedTools,
    '--max-budget-usd',
    args.budget!,
    '--no-session-persistence',
  ];
  if (args.model) {
    a.push('--model', args.model);
  }
  if (args['with-hook']) {
    const hook = path.join(repoRoot, 'docs/hooks/block-jvm-fallbacks.mjs');
    a.push(
      '--settings',
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node ${hook}` }] }] },
      }),
    );
  }
  return a;
}

async function runOne(p: EvalPrompt, mcpConfig: string): Promise<string[]> {
  const proc = Bun.spawn(['claude', ...claudeArgs(p.prompt, mcpConfig)], {
    cwd: args.project,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), Number(args.timeout) * 1000);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  clearTimeout(timer);
  if (stderr.trim()) {
    writeFileSync(path.join(outDir, `${p.id}.stderr.txt`), stderr);
  }
  return stdout.split('\n').filter((l) => l.trim().length > 0);
}

async function runAll(): Promise<void> {
  const mcpConfig = buildMcpConfig();
  const queue = [...prompts];
  let done = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const lines = await runOne(p, mcpConfig);
      writeFileSync(path.join(outDir, `${p.id}.jsonl`), lines.join('\n'));
      console.log(`[${++done}/${prompts.length}] ${p.id} (${p.category})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency)) }, worker));
}

async function eagerTokens(): Promise<number | null> {
  try {
    const proc = Bun.spawn(['npx', 'tsx', path.join(repoRoot, 'scripts/measure-eager-tokens.ts'), '--json'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    return (JSON.parse(await new Response(proc.stdout).text()) as { total: number }).total;
  } catch {
    return null;
  }
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const mark = (value: number, target: number) => (value >= target ? 'ok ' : 'LOW');

function printReport(scores: PromptScore[], tokens: number | null): void {
  const total = aggregate(scores);
  console.log('\n=== Per category ===');
  console.table(
    Object.entries(aggregateByCategory(scores)).map(([category, a]) => ({
      category,
      n: a.prompts,
      recall: pct(a.selectionRecall),
      firstCallOk: pct(a.firstCallSuccess),
      usable: pct(a.firstCallUsable),
      firstToolOk: pct(a.firstToolAccuracy),
      calls: a.callsPerTask.toFixed(1),
      fallback: pct(a.fallbackRate),
      pass: pct(a.passRate),
    })),
  );
  console.log('=== Overall ===');
  console.log(`selection recall      ${pct(total.selectionRecall)}  [${mark(total.selectionRecall, TARGETS.selectionRecall)} target ${pct(TARGETS.selectionRecall)}]`);
  console.log(`selection precision   ${pct(total.selectionPrecision)}`);
  console.log(`first-call success    ${pct(total.firstCallSuccess)}  [${mark(total.firstCallSuccess, TARGETS.firstCallSuccess)} target ${pct(TARGETS.firstCallSuccess)}]`);
  console.log(`first-call usable     ${pct(total.firstCallUsable)}  (success + retry-ready ambiguity answers)`);
  console.log(`first-tool accuracy   ${pct(total.firstToolAccuracy)}   (sibling-confusion signal)`);
  console.log(`calls per task        ${total.callsPerTask.toFixed(1)}`);
  console.log(`shell fallback rate   ${pct(total.fallbackRate)}`);
  console.log(`web used              ${scores.filter((s) => s.webUsed).length} prompt(s)`);
  console.log(`eager tokens (approx) ${tokens ?? 'n/a'}`);
  const failed = scores.filter((s) => !s.passed);
  if (failed.length > 0) {
    console.log('\n=== Failed prompts ===');
    for (const s of failed) {
      const why = s.expectJvmsrc
        ? s.fallbackUsed
          ? 'used shell fallback'
          : 'never called jvmsrc'
        : 'called jvmsrc on a non-dependency question';
      console.log(`${s.id} (${s.category}): ${why}${s.runError ? ` [${s.runError}]` : ''}`);
    }
  }
}

if (args['dry-run']) {
  for (const p of prompts) {
    console.log(['claude', ...claudeArgs(p.prompt, path.join(outDir, 'mcp-config.json'))].map((x) => JSON.stringify(x)).join(' '));
  }
  process.exit(0);
}

if (args.rescore) {
  if (!existsSync(outDir)) {
    throw new Error(`No such results directory: ${outDir}`);
  }
} else {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  console.log(`Running ${prompts.length} prompt(s) → ${outDir}`);
  await runAll();
}

const scores = prompts
  .filter((p) => existsSync(path.join(outDir, `${p.id}.jsonl`)))
  .map((p) => scorePrompt(p, parseTranscript(readFileSync(path.join(outDir, `${p.id}.jsonl`), 'utf8').split('\n'))));
const tokens = await eagerTokens();
printReport(scores, tokens);
writeFileSync(
  path.join(outDir, 'summary.json'),
  JSON.stringify({ args, tokens, aggregate: aggregate(scores), byCategory: aggregateByCategory(scores), scores }, null, 2),
);
console.log(`\nSaved ${path.join(outDir, 'summary.json')}`);
