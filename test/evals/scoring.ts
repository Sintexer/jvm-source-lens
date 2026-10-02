/**
 * Pure scoring for the MCP eval harness: parses a Claude Code `stream-json` transcript into tool calls
 * and turns them into the metrics from the UX plan (selection recall/precision, first-call success,
 * calls per task, shell-fallback rate). No I/O, so it is unit-tested without a model.
 */

export type EvalPrompt = {
  id: string;
  category: 'direct' | 'indirect' | 'multimodule' | 'sloppy' | 'filecontext' | 'negative';
  prompt: string;
  /** Should the agent use jvmsrc at all? `false` for negative prompts. */
  expectJvmsrc: boolean;
  /** jvmsrc tools that are a sensible FIRST jvmsrc call for this prompt (any-of). */
  expectFirstTools: string[];
  /**
   * `filecontext` prompts only name a file the user is editing; the agent should map it to this module
   * (Gradle path) and pass `modulePath` on its first jvmsrc call.
   */
  expectModule?: string;
};

export type ToolCall = {
  id: string;
  /** Raw tool name, e.g. `mcp__jvmsrc__get_class_structure` or `Bash`. */
  name: string;
  input: Record<string, unknown>;
  /** Filled from the matching tool_result; `undefined` when no result was seen. */
  isError?: boolean;
  /** Text of the matching tool_result (all text blocks joined). */
  resultText?: string;
};

export type ParsedTranscript = {
  calls: ToolCall[];
  numTurns?: number;
  costUsd?: number;
  durationMs?: number;
  /** The run itself failed (budget, crash), independent of tool errors. */
  runError?: string;
};

const JVMSRC_PREFIX = 'mcp__jvmsrc__';

export const isJvmsrcTool = (name: string): boolean => name.startsWith(JVMSRC_PREFIX);
export const shortToolName = (name: string): string => (isJvmsrcTool(name) ? name.slice(JVMSRC_PREFIX.length) : name);

/** Shell commands that dig into JARs / caches instead of asking jvmsrc (mirrors docs/hooks/block-jvm-fallbacks.mjs). */
const FALLBACK_COMMAND = [
  /(^|[\s;&|(])javap(\s|$)/,
  /(^|[\s;&|(])(unzip|zipinfo)\b[^|;&]*\.jar\b/,
  /(^|[\s;&|(])jar\s+-?[a-zA-Z]*[tx]/,
  /\.gradle[\\/]caches/,
  /\.m2[\\/]repository/,
];

export function isFallbackCommand(command: string): boolean {
  return FALLBACK_COMMAND.some((re) => re.test(command));
}

function resultTextOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
  }
  return '';
}

/**
 * An error that tells the agent the exact retry call because the question is genuinely ambiguous
 * (e.g. the same class at different versions per module). Correct behavior, not a bad first call.
 */
export function isRetryReadyError(call: ToolCall): boolean {
  // Only genuine ambiguity: the class differs per module, or a simple name matches several classes.
  // Generic "pass modulePath" module errors are tolerance gaps and must still count as failures.
  return (
    call.isError === true &&
    /resolves to different artifacts per module|is not fully qualified and matches/.test(call.resultText ?? '')
  );
}

/** Parses `claude -p --output-format stream-json --verbose` lines; unknown/garbled lines are skipped. */
export function parseTranscript(lines: string[]): ParsedTranscript {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  const out: ParsedTranscript = { calls };

  for (const line of lines) {
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const content = ev?.message?.content;
    if (ev?.type === 'assistant' && Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === 'tool_use' && typeof item.name === 'string') {
          const call: ToolCall = { id: String(item.id ?? calls.length), name: item.name, input: item.input ?? {} };
          calls.push(call);
          byId.set(call.id, call);
        }
      }
    } else if (ev?.type === 'user' && Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === 'tool_result') {
          const call = byId.get(String(item.tool_use_id));
          if (call) {
            call.isError = Boolean(item.is_error);
            call.resultText = resultTextOf(item.content);
          }
        }
      }
    } else if (ev?.type === 'result') {
      out.numTurns = typeof ev.num_turns === 'number' ? ev.num_turns : undefined;
      out.costUsd = typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : undefined;
      out.durationMs = typeof ev.duration_ms === 'number' ? ev.duration_ms : undefined;
      if (ev.is_error) {
        out.runError = String(ev.subtype ?? ev.result ?? 'error');
      }
    }
  }
  return out;
}

export type PromptScore = {
  id: string;
  category: EvalPrompt['category'];
  expectJvmsrc: boolean;
  /** At least one jvmsrc tool was called. */
  selected: boolean;
  jvmsrcCalls: number;
  firstTool: string | null;
  /** First jvmsrc call returned without `isError`; `null` when jvmsrc was never called. */
  firstCallOk: boolean | null;
  /** First call succeeded, or failed with a retry-ready answer to a genuinely ambiguous question. */
  firstCallUsable: boolean | null;
  /** First jvmsrc call carried a concrete `modulePath` (not omitted, not `*`/`all`); `null` when no module expectation. */
  modulePassed: boolean | null;
  /** ...and it points at `expectModule` (Gradle path, or a path inside that module). */
  moduleCorrect: boolean | null;
  /** First jvmsrc call is one of `expectFirstTools`; `null` when not applicable. */
  firstToolExpected: boolean | null;
  /** Ran javap/unzip/jar/Gradle-cache style shell commands. */
  fallbackUsed: boolean;
  webUsed: boolean;
  /** Positive prompt: used jvmsrc and no shell fallback. Negative prompt: did not use jvmsrc. */
  passed: boolean;
  numTurns?: number;
  costUsd?: number;
  runError?: string;
};

/** Does `given` (a Gradle path, bare name, or file/dir path) denote `expected` (Gradle path)? */
export function modulePathMatches(given: string, expected: string): boolean {
  const bare = expected.replace(/^:+/, '').toLowerCase();
  const g = given.trim().toLowerCase().replace(/\\/g, '/');
  return g.replace(/^[:/]+|[:/]+$/g, '').replace(/:/g, '/') === bare.replace(/:/g, '/') || g.includes(`/${bare.replace(/:/g, '/')}/`) || g.startsWith(`${bare.replace(/:/g, '/')}/`);
}

export function scorePrompt(p: EvalPrompt, t: ParsedTranscript): PromptScore {
  const jv = t.calls.filter((c) => isJvmsrcTool(c.name));
  const first = jv[0];
  const fallbackUsed = t.calls.some(
    (c) => c.name === 'Bash' && typeof c.input.command === 'string' && isFallbackCommand(c.input.command),
  );
  const webUsed = t.calls.some((c) => c.name === 'WebSearch' || c.name === 'WebFetch');
  const selected = jv.length > 0;
  return {
    id: p.id,
    category: p.category,
    expectJvmsrc: p.expectJvmsrc,
    selected,
    jvmsrcCalls: jv.length,
    firstTool: first ? shortToolName(first.name) : null,
    firstCallOk: first ? first.isError !== true : null,
    firstCallUsable: first ? first.isError !== true || isRetryReadyError(first) : null,
    modulePassed:
      first && p.expectModule !== undefined
        ? typeof first.input.modulePath === 'string' && first.input.modulePath.trim() !== '' && !/^(\*|all)$/i.test(first.input.modulePath.trim())
        : p.expectModule !== undefined
          ? false
          : null,
    moduleCorrect:
      p.expectModule === undefined
        ? null
        : first !== undefined &&
          typeof first.input.modulePath === 'string' &&
          modulePathMatches(first.input.modulePath, p.expectModule),
    firstToolExpected: first && p.expectJvmsrc ? p.expectFirstTools.includes(shortToolName(first.name)) : null,
    fallbackUsed,
    webUsed,
    passed: p.expectJvmsrc ? selected && !fallbackUsed : !selected,
    numTurns: t.numTurns,
    costUsd: t.costUsd,
    runError: t.runError,
  };
}

export type Aggregate = {
  prompts: number;
  /** Positives that used jvmsrc / positives. */
  selectionRecall: number;
  /** Positives that used jvmsrc / all prompts that used jvmsrc (negatives that used it lower this). */
  selectionPrecision: number;
  /** Prompts whose first jvmsrc call succeeded / prompts that called jvmsrc. */
  firstCallSuccess: number;
  /** Like firstCallSuccess, but retry-ready ambiguity answers count as usable (not a failure of the tool). */
  firstCallUsable: number;
  /** Of prompts with an applicable expectation, share whose first jvmsrc call was an expected tool. */
  firstToolAccuracy: number;
  /** Mean jvmsrc calls per positive prompt that used jvmsrc. */
  callsPerTask: number;
  /** Positives that ran a shell fallback / positives. */
  fallbackRate: number;
  /** Of prompts that expect a module: first jvmsrc call passed a concrete modulePath. */
  modulePassRate: number;
  /** ...and it was the right module. */
  moduleCorrectRate: number;
  passRate: number;
};

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

export function aggregate(scores: PromptScore[]): Aggregate {
  const positives = scores.filter((s) => s.expectJvmsrc);
  const selectedAll = scores.filter((s) => s.selected);
  const selectedPos = positives.filter((s) => s.selected);
  const called = scores.filter((s) => s.firstCallOk !== null);
  const expectable = scores.filter((s) => s.firstToolExpected !== null);
  const withModule = scores.filter((s) => s.moduleCorrect !== null);
  return {
    prompts: scores.length,
    selectionRecall: ratio(selectedPos.length, positives.length),
    selectionPrecision: ratio(selectedPos.length, selectedAll.length),
    firstCallSuccess: ratio(called.filter((s) => s.firstCallOk).length, called.length),
    firstCallUsable: ratio(called.filter((s) => s.firstCallUsable).length, called.length),
    firstToolAccuracy: ratio(expectable.filter((s) => s.firstToolExpected).length, expectable.length),
    callsPerTask: ratio(selectedPos.reduce((n, s) => n + s.jvmsrcCalls, 0), selectedPos.length),
    fallbackRate: ratio(positives.filter((s) => s.fallbackUsed).length, positives.length),
    modulePassRate: ratio(withModule.filter((s) => s.modulePassed).length, withModule.length),
    moduleCorrectRate: ratio(withModule.filter((s) => s.moduleCorrect).length, withModule.length),
    passRate: ratio(scores.filter((s) => s.passed).length, scores.length),
  };
}

export function aggregateByCategory(scores: PromptScore[]): Record<string, Aggregate> {
  const cats = [...new Set(scores.map((s) => s.category))];
  return Object.fromEntries(cats.map((c) => [c, aggregate(scores.filter((s) => s.category === c))]));
}

/** Targets from the UX plan; used only to print pass/fail next to the numbers. */
export const TARGETS = { selectionRecall: 0.95, firstCallSuccess: 0.95 } as const;
