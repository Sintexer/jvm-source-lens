import { describe, expect, test } from 'bun:test';
import {
  TARGETS,
  aggregate,
  assessTargets,
  modulePathMatches,
  isFallbackCommand,
  parseTranscript,
  scorePrompt,
  type Aggregate,
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
  test('hierarchy routing requires the expected target argument, module, tool and depth', () => {
    const prompt = { ...positive, expectModule: ':app', expectFirstTools: ['find_subtypes'], expectDirectOnly: true, expectTarget: { typeName: 'a.Target' } };
    const call = (input: object, tool = 'find_subtypes') => parseTranscript([use('a', `mcp__jvmsrc__${tool}`, input), result('a')]);
    const args = { modulePath: ':app', directOnly: true, typeName: 'a.Target' };
    expect(scorePrompt(prompt, call(args)).passed).toBe(true);
    expect(scorePrompt(prompt, call({ ...args, modulePath: ':worker' })).passed).toBe(false);
    expect(scorePrompt(prompt, call(args, 'search_classes')).passed).toBe(false);
    expect(scorePrompt(prompt, call({ ...args, typeName: 'a.Other' })).passed).toBe(false);
    expect(scorePrompt(prompt, call({ modulePath: ':app', directOnly: true, className: 'a.Target' })).passed).toBe(false);
    const defaultDepth = call({ modulePath: ':app', typeName: 'a.Target' });
    expect(scorePrompt(prompt, defaultDepth).passed).toBe(false);
    expect(scorePrompt({ ...prompt, expectDirectOnly: false }, defaultDepth).passed).toBe(true);
  });

  test('keeps the final answer for manual review independently of successful routing', () => {
    const prompt = { ...positive, reviewFinalAnswer: true };
    const calls = [use('a', 'mcp__jvmsrc__get_class_structure'), result('a')];
    expect(scorePrompt(prompt, parseTranscript(calls)).answerToReview).toBeNull();
    expect(scorePrompt(prompt, parseTranscript([...calls, line({ type: 'result', result: 'No subinterfaces.' })])))
      .toMatchObject({ passed: true, answerToReview: 'No subinterfaces.' });
  });

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
    modulePassed: null,
    moduleCorrect: null,
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
    expect(aggregate([]).moduleSamples).toBe(0);
  });
});

describe('checkpoint 3 targets', () => {
  const recorded: Aggregate = {
    prompts: 44,
    selectionRecall: 1,
    selectionPrecision: 1,
    firstCallSuccess: 0.87,
    firstCallUsable: 0.97,
    firstToolAccuracy: 0.97,
    callsPerTask: 1.45,
    fallbackRate: 0,
    modulePassRate: 1,
    moduleCorrectRate: 1,
    moduleSamples: 4,
    passRate: 1,
    hookDenials: 0,
  };

  test('gates are usable first-call, filecontext module, and shell fallback', () => {
    expect(TARGETS).toEqual({
      selectionRecall: 0.95,
      firstCallUsable: 0.95,
      moduleCorrectRate: 0.9,
      fallbackRate: 0,
    });
    expect(TARGETS).not.toHaveProperty('firstCallSuccess');
  });

  test('the recorded default run meets every gate', () => {
    const rows = assessTargets(recorded);
    expect(rows.map((row) => row.metric).sort()).toEqual(
      ['fallbackRate', 'firstCallUsable', 'moduleCorrectRate', 'selectionRecall'].sort(),
    );
    expect(rows.every((row) => row.met)).toBe(true);
  });

  test('usable first-call under 95% fails and strict success is not a gate', () => {
    const rows = assessTargets({ ...recorded, firstCallSuccess: 1, firstCallUsable: 0.94 });
    expect(rows.find((row) => row.metric === 'firstCallUsable')?.met).toBe(false);
    expect(rows.some((row) => row.metric === 'firstCallSuccess')).toBe(false);
  });

  test('a run with no filecontext prompts does not fail the module target', () => {
    const rows = assessTargets({ ...recorded, moduleSamples: 0, moduleCorrectRate: 0, modulePassRate: 0 });
    expect(rows.some((row) => row.metric === 'moduleCorrectRate')).toBe(false);
    expect(rows.every((row) => row.met)).toBe(true);
  });

  test('any shell fallback fails the fallback gate', () => {
    const rows = assessTargets({ ...recorded, fallbackRate: 0.01 });
    expect(rows.find((row) => row.metric === 'fallbackRate')?.met).toBe(false);
  });
});

test('prompts.json is well-formed and matches the planned mix', async () => {
  const prompts = (await Bun.file(new URL('./prompts.json', import.meta.url)).json()) as EvalPrompt[];
  const counts = Object.fromEntries(
    [...new Set(prompts.map((p) => p.category))].map((c) => [c, prompts.filter((p) => p.category === c).length]),
  );
  expect(counts).toEqual({ direct: 14, indirect: 10, multimodule: 8, sloppy: 6, filecontext: 4, kotlin: 4, negative: 6 });
  expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
  for (const p of prompts) {
    expect(p.expectJvmsrc).toBe(p.category !== 'negative');
    expect(p.expectModule !== undefined).toBe(p.category === 'filecontext');
    expect(p.expectFirstTools.length > 0).toBe(p.expectJvmsrc);
  }
});

describe('module-passing metric', () => {
  const fileCtx: EvalPrompt = {
    id: 'f1',
    category: 'filecontext',
    prompt: 'x',
    expectJvmsrc: true,
    expectFirstTools: ['get_method_signature'],
    expectModule: ':worker',
  };
  const callWith = (input: object) => parseTranscript([use('a', 'mcp__jvmsrc__get_method_signature', input), result('a')]);

  test.each([':worker', 'worker', '/worker', 'worker/src/main/java/com/acme/Worker.java', '/abs/proj/worker/src/X.java'])(
    'modulePath %j counts as the right module',
    (modulePath) => {
      expect(scorePrompt(fileCtx, callWith({ className: 'a.B', modulePath }))).toMatchObject({ modulePassed: true, moduleCorrect: true });
    },
  );

  test('a wrong module is passed but not correct', () => {
    expect(scorePrompt(fileCtx, callWith({ modulePath: ':app' }))).toMatchObject({ modulePassed: true, moduleCorrect: false });
    expect(modulePathMatches(':workers', ':worker')).toBe(false);
  });

  test('omitted, empty and wildcard modules count as not passed', () => {
    for (const input of [{}, { modulePath: '' }, { modulePath: '*' }, { modulePath: 'all' }]) {
      expect(scorePrompt(fileCtx, callWith(input))).toMatchObject({ modulePassed: false, moduleCorrect: false });
    }
  });

  test('never calling jvmsrc is not passing a module', () => {
    expect(scorePrompt(fileCtx, parseTranscript([use('a', 'Grep')]))).toMatchObject({ modulePassed: false, moduleCorrect: false });
  });

  test('prompts without a module expectation are not scored on it', () => {
    expect(scorePrompt(positive, callWith({ modulePath: ':app' }))).toMatchObject({ modulePassed: null, moduleCorrect: null });
  });

  test('aggregate rates cover only prompts that expect a module', () => {
    const a = aggregate([
      scorePrompt(fileCtx, callWith({ modulePath: ':worker' })),
      scorePrompt(fileCtx, callWith({ modulePath: ':app' })),
      scorePrompt(fileCtx, callWith({})),
      scorePrompt(positive, callWith({})),
    ]);
    expect(a.modulePassRate).toBeCloseTo(2 / 3);
    expect(a.moduleCorrectRate).toBeCloseTo(1 / 3);
  });
});

describe('PreToolUse hook denials', () => {
  const denied = (id: string) =>
    line({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            is_error: true,
            content: 'Blocked: javap reads whatever version is on disk, not the one this build resolves. Use the jvmsrc MCP tools instead: …',
          },
        ],
      },
    });

  test('shouldNotCountFallbackWhenHookBlockedTheCommand', () => {
    const s = scorePrompt(
      positive,
      parseTranscript([use('a', 'Bash', { command: 'javap -p Foo' }), denied('a'), use('b', 'mcp__jvmsrc__get_class_structure'), result('b')]),
    );
    expect(s.fallbackUsed).toBe(false);
    expect(s.hookDenials).toBe(1);
    expect(s.passed).toBe(true);
  });

  test('shouldCountFallbackWhenCommandRanWithoutHook', () => {
    const s = scorePrompt(positive, parseTranscript([use('a', 'Bash', { command: 'javap -p Foo' }), result('a')]));
    expect(s.fallbackUsed).toBe(true);
    expect(s.hookDenials).toBe(0);
  });

  test('shouldSumHookDenialsInAggregate', () => {
    const t = parseTranscript([use('a', 'Bash', { command: 'javap -p Foo' }), denied('a')]);
    expect(aggregate([scorePrompt(positive, t), scorePrompt(positive, t)]).hookDenials).toBe(2);
  });
});

describe('retry-ready phrases are shared with the producers', () => {
  test('shouldDetectRetryReadyErrorWhenTextUsesSharedPhrases', async () => {
    const { PER_MODULE_ARTIFACT_PHRASE, NOT_FULLY_QUALIFIED_PHRASE } = await import('../../src/copy/retry-ready-phrases.js');
    const { isRetryReadyError } = await import('./scoring.js');
    expect(isRetryReadyError({ isError: true, resultText: `Class "X" ${PER_MODULE_ARTIFACT_PHRASE}: a, b.` } as never)).toBe(true);
    expect(isRetryReadyError({ isError: true, resultText: `"X" ${NOT_FULLY_QUALIFIED_PHRASE} 2 classes: a, b.` } as never)).toBe(true);
  });
});
