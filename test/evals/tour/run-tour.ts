/**
 * Tour demo: one long Claude Code session per arm answers ~10 dependency questions in a row on
 * test/evals/tour/project. Arms differ only in how the agent may look at dependencies:
 *
 *   jvmsrc  the jvmsrc MCP server (plus the same shell tools as every arm)
 *   smart   no MCP; a system-prompt hint explains where Gradle caches and sources jars live
 *   naive   no MCP, no hint
 *
 * Per question it records tokens (incl. cache reads), cost, time, tool calls, correctness, and whether the
 * project tree was written to. Spends real tokens; NOT part of CI. See test/evals/tour/README.md.
 *
 *   bun run tour                       # 3 arms x 1 rep, all questions
 *   bun run tour --reps 3 --arms jvmsrc,smart
 *   bun run tour --limit 3 --dry-run   # print the claude commands only
 *   bun run tour --rescore test/evals/results/tour-<stamp>
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cumulative, deltas, mutatedFiles, parseTurn, scoreAnswer, totalTokens, type TourQuestion, type TourTurn } from './tour-scoring.js';
import { isFallbackCommand } from '../scoring.js';
import { ensureRepo, prepareProject } from './fixture.js';

const here = import.meta.dir;
const repoRoot = path.resolve(here, '../../..');

const { values: args } = parseArgs({
  options: {
    arms: { type: 'string', default: 'jvmsrc,smart,naive' },
    reps: { type: 'string', default: '1' },
    model: { type: 'string' },
    limit: { type: 'string' },
    budget: { type: 'string', default: '0.75' },
    timeout: { type: 'string', default: '300' },
    out: { type: 'string' },
    rescore: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

type Step = ({ id: string; kind: string; prompt: string } & TourQuestion) | { action: 'bump'; file: string; from: string; to: string };
const allSteps = JSON.parse(readFileSync(path.join(here, 'questions.json'), 'utf8')) as Step[];
let askedSoFar = 0;
const steps = allSteps.filter((s) => !('prompt' in s) || !args.limit || askedSoFar++ < Number(args.limit));
const questions = steps.filter((s): s is Extract<Step, { prompt: string }> => 'prompt' in s);
const arms = args.arms!.split(',').map((a) => a.trim());
for (const a of arms) {
  if (!['jvmsrc', 'smart', 'naive'].includes(a)) throw new Error(`unknown arm ${a}`);
}

const outDir = path.resolve(args.rescore ?? args.out ?? path.join(repoRoot, 'test/evals/results', `tour-${new Date().toISOString().replace(/[:.]/g, '-')}`));

// Identical shell access for every arm: only the MCP server and the hint differ. Bash is open (compound
// commands like `cd x && ls` must work, or the baselines are crippled; an early run lost that way), minus
// destructive and network commands. Runs happen in a temp copy of the project; the agent only reads.
const DENIED_SHELL = ['rm', 'mv', 'cp', 'curl', 'wget', 'sudo', 'chmod', 'git', 'ssh', 'scp'].map((c) => `Bash(${c} *)`);
const allowedTools = (arm: string) => [...(arm === 'jvmsrc' ? ['mcp__jvmsrc__*'] : []), 'Read', 'Grep', 'Glob', 'Bash'].join(',');

const SMART_HINT =
  'Dependency jars are in ~/.gradle/caches/modules-2/files-2.1/<group>/<artifact>/<version>/<hash>/ and sources jars sit next to them. ' +
  'Repositories (including local file:// Maven repos, read in place) are declared in build.gradle. ' +
  'Use `gradle :app:dependencies --configuration compileClasspath` to find the version Gradle really selects (conflicts resolve to the highest). ' +
  'Use unzip to read sources jars and javap to read signatures when there are no sources.';

/** Builds the internal binary jar (no sources) once; it is git-ignored. */
function ensureInternalJar(): void {
  const jar = path.join(here, 'project/app/libs/acme-pricing.jar');
  if (existsSync(jar)) return;
  const classes = mkdtempSync(path.join(tmpdir(), 'tour-jar-'));
  mkdirSync(path.dirname(jar), { recursive: true });
  for (const [cmd, ...rest] of [
    ['javac', '-d', classes, path.join(here, 'internal-src/acme/pricing/PricingEngine.java')],
    ['jar', 'cf', jar, '-C', classes, '.'],
  ]) {
    const r = Bun.spawnSync([cmd!, ...rest]);
    if (r.exitCode !== 0) throw new Error(`${cmd} failed: ${r.stderr.toString()}`);
  }
}

function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(path.relative(root, full), String(Bun.hash(readFileSync(full))));
    }
  };
  walk(root);
  return out;
}

function claudeArgs(arm: string, prompt: string, session: { id: string; first: boolean }, runDir: string): string[] {
  const a = [
    '-p', prompt, '--output-format', 'stream-json', '--verbose',
    session.first ? '--session-id' : '--resume', session.id,
    '--strict-mcp-config', '--setting-sources', 'project',
    '--permission-mode', 'dontAsk', '--allowedTools', allowedTools(arm), '--disallowedTools', DENIED_SHELL.join(','),
    '--max-budget-usd', args.budget!,
  ];
  if (arm === 'jvmsrc') {
    a.push('--mcp-config', path.join(runDir, 'mcp-config.json'));
  }
  if (arm === 'smart') {
    a.push('--append-system-prompt', SMART_HINT);
  }
  if (args.model) a.push('--model', args.model);
  return a;
}

function writeMcpConfig(runDir: string): void {
  const config = {
    mcpServers: {
      jvmsrc: {
        command: process.execPath,
        args: [path.join(repoRoot, 'src/cli.ts'), 'mcp'],
        // Fresh cache per run: the first jvmsrc call pays the cold resolve, like a new user.
        env: { JVMSRC_CACHE_ROOT: path.join(runDir, 'jvmsrc-cache'), JAVA_HOME: process.env.JAVA_HOME ?? '' },
      },
    },
  };
  writeFileSync(path.join(runDir, 'mcp-config.json'), JSON.stringify(config, null, 2));
}

type Row = {
  arm: string; rep: number; id: string; kind: string; correct: boolean;
  tokens: number; cacheRead: number; costUsd: number; durationMs: number;
  calls: number; jvmsrcCalls: number; shellFallbacks: number; gradleRuns: number;
  mutated: string[]; runError?: string;
};

function rowOf(arm: string, rep: number, q: Extract<Step, { prompt: string }>, turn: TourTurn, mutated: string[]): Row {
  const bash = turn.calls.filter((c) => c.name === 'Bash').map((c) => String(c.input.command ?? ''));
  return {
    arm, rep, id: q.id, kind: q.kind, correct: scoreAnswer(q, turn.finalAnswer),
    tokens: totalTokens(turn.usage), cacheRead: turn.usage.cacheRead, costUsd: turn.costUsd ?? 0, durationMs: turn.durationMs ?? 0,
    calls: turn.calls.length,
    jvmsrcCalls: turn.calls.filter((c) => c.name.startsWith('mcp__jvmsrc__')).length,
    shellFallbacks: bash.filter(isFallbackCommand).length,
    gradleRuns: bash.filter((c) => /(^|[\s;&|])(\.\/gradlew|gradle)\b/.test(c)).length,
    mutated, runError: turn.runError,
  };
}

async function runSession(arm: string, rep: number): Promise<Row[]> {
  const runDir = path.join(outDir, `${arm}-${rep}`);
  mkdirSync(runDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), `tour-${arm}-${rep}-`));
  const project = path.join(work, 'project');
  prepareProject(project);
  if (arm === 'jvmsrc') writeMcpConfig(runDir);
  const session = { id: crypto.randomUUID(), first: true };
  const baseline = snapshot(project);
  const rows: Row[] = [];
  for (const step of steps) {
    if (!('prompt' in step)) {
      const file = path.join(project, step.file);
      const text = readFileSync(file, 'utf8');
      if (!text.includes(step.from)) throw new Error(`bump: ${step.from} not found in ${step.file}`);
      writeFileSync(file, text.replace(step.from, step.to));
      baseline.set(step.file, String(Bun.hash(readFileSync(file)))); // the bump itself is not a mutation by the agent
      continue;
    }
    const proc = Bun.spawn(['claude', ...claudeArgs(arm, step.prompt, session, runDir)], { cwd: project, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), Number(args.timeout) * 1000);
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    clearTimeout(timer);
    session.first = false;
    const lines = stdout.split('\n').filter((l) => l.trim());
    writeFileSync(path.join(runDir, `${step.id}.jsonl`), lines.join('\n'));
    const after = snapshot(project);
    rows.push(rowOf(arm, rep, step, parseTurn(lines), mutatedFiles(baseline, after)));
    console.log(`${arm}#${rep} ${step.id} ${rows.at(-1)!.correct ? 'ok ' : 'BAD'} ${rows.at(-1)!.tokens} tok`);
  }
  return withTurnCost(rows);
}

/** `costUsd` arrives session-cumulative; rewrite it as per-turn cost. */
function withTurnCost(rows: Row[]): Row[] {
  const per = deltas(rows.map((r) => r.costUsd));
  return rows.map((r, i) => ({ ...r, costUsd: per[i]! }));
}

/** Re-scores saved transcripts (no model calls); mutation data is not stored, so it reads as unknown/empty. */
function rescore(): Row[] {
  const rows: Row[] = [];
  for (const arm of arms) {
    for (let rep = 1; existsSync(path.join(outDir, `${arm}-${rep}`)); rep++) {
      const session: Row[] = [];
      for (const q of questions) {
        const file = path.join(outDir, `${arm}-${rep}`, `${q.id}.jsonl`);
        if (existsSync(file)) session.push(rowOf(arm, rep, q, parseTurn(readFileSync(file, 'utf8').split('\n')), []));
      }
      rows.push(...withTurnCost(session));
    }
  }
  return rows;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function report(rows: Row[]): void {
  for (const arm of arms) {
    const armRows = rows.filter((r) => r.arm === arm);
    if (armRows.length === 0) continue;
    const reps = [...new Set(armRows.map((r) => r.rep))];
    const perQ = questions.map((q) => {
      const rs = armRows.filter((r) => r.id === q.id);
      return { q: q.id, kind: q.kind, correct: `${rs.filter((r) => r.correct).length}/${rs.length}`, tokens: Math.round(mean(rs.map((r) => r.tokens))), cost: +mean(rs.map((r) => r.costUsd)).toFixed(3), sec: +(mean(rs.map((r) => r.durationMs)) / 1000).toFixed(1), calls: +mean(rs.map((r) => r.calls)).toFixed(1) };
    });
    const cumCost = cumulative(perQ.map((p) => p.cost));
    const cumTok = cumulative(perQ.map((p) => p.tokens));
    console.log(`\n=== ${arm} (${reps.length} rep) ===`);
    console.table(perQ.map((p, i) => ({ ...p, cumTokens: cumTok[i], cumCost: +cumCost[i]!.toFixed(3) })));
    console.log(`correct ${armRows.filter((r) => r.correct).length}/${armRows.length}, gradle runs ${armRows.reduce((a, r) => a + r.gradleRuns, 0)}, shell fallbacks ${armRows.reduce((a, r) => a + r.shellFallbacks, 0)}, runs that wrote to the project: ${reps.filter((rep) => armRows.some((r) => r.rep === rep && r.mutated.length > 0)).length}/${reps.length}`);
    const files = [...new Set(armRows.flatMap((r) => r.mutated))];
    if (files.length) console.log(`  project files written: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ' …' : ''}`);
  }
}

if (args['dry-run']) {
  for (const arm of arms) {
    for (const q of questions.slice(0, 2)) {
      console.log(['claude', ...claudeArgs(arm, q.prompt, { id: '<uuid>', first: q === questions[0] }, `<out>/${arm}-1`)].map((x) => JSON.stringify(x)).join(' '));
    }
  }
  process.exit(0);
}

let rows: Row[];
if (args.rescore) {
  rows = rescore();
} else {
  ensureInternalJar();
  ensureRepo();
  mkdirSync(outDir, { recursive: true });
  console.log(`Tour → ${outDir}`);
  // Arms run in parallel (separate work dirs and sessions); reps of one arm run in sequence.
  const perArm = await Promise.all(arms.map(async (arm) => {
    const out: Row[] = [];
    for (let rep = 1; rep <= Number(args.reps); rep++) out.push(...(await runSession(arm, rep)));
    return out;
  }));
  rows = perArm.flat();
}
report(rows);
writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ args, rows }, null, 2));
console.log(`\nSaved ${path.join(outDir, 'summary.json')}`);
