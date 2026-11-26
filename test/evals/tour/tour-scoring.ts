/**
 * Pure scoring for the tour demo: per-turn token usage, answer correctness and project-tree mutation.
 * No I/O, so it is unit-tested without a model. Tool-call parsing is shared with ../scoring.ts.
 */
import { parseTranscript, type ParsedTranscript } from '../scoring.js';

export type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number };

export type TourTurn = ParsedTranscript & { usage: Usage };

export type TourQuestion = { expect: string[]; reject?: string[] };

export const totalTokens = (u: Usage): number => u.input + u.cacheWrite + u.cacheRead + u.output;

export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v));
}

/** Claude Code reports `total_cost_usd` for the whole resumed session; this gives the cost of each turn. */
export function deltas(cumulativeValues: number[]): number[] {
  return cumulativeValues.map((v, i) => v - (cumulativeValues[i - 1] ?? 0));
}

/** Parses one `claude -p --output-format stream-json` invocation (one question). */
export function parseTurn(lines: string[]): TourTurn {
  const usage: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  for (const line of lines) {
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev?.type === 'result' && ev.usage) {
      usage.input = Number(ev.usage.input_tokens ?? 0);
      usage.cacheWrite = Number(ev.usage.cache_creation_input_tokens ?? 0);
      usage.cacheRead = Number(ev.usage.cache_read_input_tokens ?? 0);
      usage.output = Number(ev.usage.output_tokens ?? 0);
    }
  }
  return { ...parseTranscript(lines), usage };
}

/** An answer is correct when every `expect` pattern matches and no `reject` pattern does (case-insensitive). */
export function scoreAnswer(q: TourQuestion, answer: string | undefined): boolean {
  if (!answer) return false;
  const has = (p: string) => new RegExp(p, 'i').test(answer);
  return q.expect.every(has) && !(q.reject ?? []).some(has);
}

/** Files added or changed between two `path → content hash` snapshots. */
export function mutatedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [file, hash] of after) {
    if (before.get(file) !== hash) out.push(file);
  }
  return out;
}
