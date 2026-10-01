import { describe, expect, test } from 'bun:test';
import {
  aggregate,
  isFallbackCommand,
  parseTranscript,
  scorePrompt,
  type EvalPrompt,
  type PromptScore,
} from './scoring.js';

const line = (o: unknown) => JSON.stringify(o);
const use = (id: string, name: string, input: object = {}) =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, is_error = false) =>
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error }] } });

const positive: EvalPrompt = {
  id: 'p1',
  category: 'direct',
  prompt: 'x',
  expectJvmsrc: true,
  expectFirstTools: ['get_class_structure'],
};
const negative: EvalPrompt = { id: 'n1', category: 'negative', prompt: 'y', expectJvmsrc: false, expectFirstTools: [] };

describe('parseTranscript', () => {
  test('pairs tool_use with tool_result and reads the result event', () => {
    const t = parseTranscript([
      line({ type: 'system', subtype: 'init' }),
      use('a', 'mcp__jvmsrc__get_class_structure', { className: 'X' }),
      result('a', true),
      use('b', 'Bash', { command: 'ls' }),
      'not json',
      line({ type: 'result', num_turns: 3, total_cost_usd: 0.12, duration_ms: 900, is_error: false }),
    ]);
    expect(t.calls.map((c) => [c.name, c.isError])).toEqual([
      ['mcp__jvmsrc__get_class_structure', true],
      ['Bash', undefined],
    ]);
    expect(t).toMatchObject({ numTurns: 3, costUsd: 0.12, durationMs: 900 });
    expect(t.runError).toBeUndefined();
  });

  test('flags a failed run', () => {
    expect(parseTranscript([line({ type: 'result', is_error: true, subtype: 'error_max_budget_usd' })]).runError).toBe(
      'error_max_budget_usd',
    );
  });
});

describe('isFallbackCommand', () => {
  test.each(['javap -cp a.jar X', 'unzip -l a.jar', 'jar tf a.jar', 'ls ~/.gradle/caches', 'cat ~/.m2/repository/x'])(
    'flags %j',
    (c) => expect(isFallbackCommand(c)).toBe(true),
  );
  test.each(['ls', './gradlew build', 'unzip data.zip', 'grep -r UserService .'])('allows %j', (c) =>
    expect(isFallbackCommand(c)).toBe(false),
  );
});

describe('scorePrompt', () => {
  test('positive prompt: jvmsrc first, expected tool, no fallback', () => {
    const s = scorePrompt(
      positive,
      parseTranscript([use('a', 'mcp__jvmsrc__get_class_structure'), result('a'), use('b', 'mcp__jvmsrc__get_class_source'), result('b')]),
    );
    expect(s).toMatchObject({ selected: true, jvmsrcCalls: 2, firstCallOk: true, firstToolExpected: true, passed: true });
  });

  test('positive prompt that falls back to javap fails even if jvmsrc was also used', () => {
    const s = scorePrompt(
      positive,
      parseTranscript([use('a', 'mcp__jvmsrc__search_classes'), result('a'), use('b', 'Bash', { command: 'javap -cp x.jar Y' })]),
    );
    expect(s).toMatchObject({ selected: true, fallbackUsed: true, firstToolExpected: false, passed: false });
  });

  test('positive prompt that never calls jvmsrc', () => {
    const s = scorePrompt(positive, parseTranscript([use('a', 'WebSearch')]));
    expect(s).toMatchObject({ selected: false, firstCallOk: null, firstToolExpected: null, webUsed: true, passed: false });
  });

  test('negative prompt passes only when jvmsrc is unused', () => {
    expect(scorePrompt(negative, parseTranscript([use('a', 'Grep')])).passed).toBe(true);
    expect(scorePrompt(negative, parseTranscript([use('a', 'mcp__jvmsrc__search_classes')])).passed).toBe(false);
  });
});

describe('retry-ready errors', () => {
  const resultWithText = (id: string, text: string) =>
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: [{ type: 'text', text }] }] } });

  test('an ambiguity error with a retry call is usable but not a success', () => {
    const t = parseTranscript([
      use('a', 'mcp__jvmsrc__get_class_structure'),
      resultWithText('a', 'Class X resolves to different artifacts per module. Retry with modulePath=":app" or modulePath=":worker".'),
    ]);
    expect(t.calls[0]!.resultText).toContain('Retry with modulePath');
    const s = scorePrompt(positive, t);
    expect(s).toMatchObject({ firstCallOk: false, firstCallUsable: true });
  });

  test('a generic module error that merely suggests modulePath is still a failure', () => {
    const s = scorePrompt(
      positive,
      parseTranscript([
        use('a', 'mcp__jvmsrc__search_classes'),
        resultWithText('a', 'modulePath was omitted and 3 modules have compileClasspath. Retry with modulePath: ":app".'),
      ]),
    );
    expect(s).toMatchObject({ firstCallOk: false, firstCallUsable: false });
  });

  test('an error without a retry call is a plain failure', () => {
    const s = scorePrompt(positive, parseTranscript([use('a', 'mcp__jvmsrc__get_class_source'), resultWithText('a', 'DECOMPILE_FAILED: CFR produced no source')]));
    expect(s).toMatchObject({ firstCallOk: false, firstCallUsable: false });
  });
});

describe('aggregate', () => {
  const sc = (over: Partial<PromptScore>): PromptScore => ({
    id: 'x',
    category: 'direct',
    expectJvmsrc: true,
    selected: true,
    jvmsrcCalls: 1,
    firstTool: 'search_classes',
    firstCallOk: true,
    firstCallUsable: true,
    firstToolExpected: true,
    fallbackUsed: false,
    webUsed: false,
    passed: true,
    ...over,
  });

  test('recall, precision, first-call success, calls per task', () => {
    const a = aggregate([
      sc({ jvmsrcCalls: 2 }),
      sc({ selected: false, jvmsrcCalls: 0, firstTool: null, firstCallOk: null, firstToolExpected: null, passed: false }),
      sc({ firstCallOk: false, firstCallUsable: false, firstToolExpected: false, fallbackUsed: true, passed: false }),
      sc({ category: 'negative', expectJvmsrc: false, firstToolExpected: null, passed: false }),
    ]);
    expect(a.selectionRecall).toBeCloseTo(2 / 3);
    expect(a.selectionPrecision).toBeCloseTo(2 / 3);
    expect(a.firstCallSuccess).toBeCloseTo(2 / 3);
    expect(a.firstCallUsable).toBeCloseTo(2 / 3);
    expect(a.callsPerTask).toBeCloseTo(1.5);
    expect(a.fallbackRate).toBeCloseTo(1 / 3);
    expect(a.firstToolAccuracy).toBeCloseTo(1 / 2);
    expect(a.passRate).toBeCloseTo(1 / 4);
  });

  test('empty input does not divide by zero', () => {
    expect(aggregate([]).selectionRecall).toBe(0);
  });
});

test('prompts.json is well-formed and matches the planned mix', async () => {
  const prompts = (await Bun.file(new URL('./prompts.json', import.meta.url)).json()) as EvalPrompt[];
  const counts = Object.fromEntries(
    [...new Set(prompts.map((p) => p.category))].map((c) => [c, prompts.filter((p) => p.category === c).length]),
  );
  expect(counts).toEqual({ direct: 10, indirect: 10, multimodule: 8, sloppy: 6, negative: 6 });
  expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
  for (const p of prompts) {
    expect(p.expectJvmsrc).toBe(p.category !== 'negative');
    expect(p.expectFirstTools.length > 0).toBe(p.expectJvmsrc);
  }
});
