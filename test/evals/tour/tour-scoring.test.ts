import { describe, expect, test } from 'bun:test';
import { cumulative, deltas, mutatedFiles, parseTurn, scoreAnswer, totalTokens } from './tour-scoring.js';

const resultLine = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'result',
    result: 'It uses 2.17.2 and has copyWith.',
    total_cost_usd: 0.02,
    duration_ms: 4000,
    num_turns: 3,
    usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 50 },
    ...extra,
  });

describe('parseTurn', () => {
  test('shouldReadUsageAndCostWhenResultEventPresent', () => {
    const turn = parseTurn([resultLine()]);
    expect(turn.usage).toEqual({ input: 10, cacheWrite: 200, cacheRead: 3000, output: 50 });
    expect(turn.costUsd).toBe(0.02);
    expect(turn.durationMs).toBe(4000);
  });

  test('shouldReturnZeroUsageWhenNoResultEvent', () => {
    expect(parseTurn(['garbage']).usage).toEqual({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  });
});

describe('scoreAnswer', () => {
  const q = { expect: ['copyWith', '2\\.17\\.2'], reject: ['no copyWith'] };

  test('shouldPassWhenAllExpectedPatternsMatch', () => {
    expect(scoreAnswer(q, 'Has COPYWITH, version 2.17.2')).toBe(true);
  });

  test('shouldFailWhenAnExpectedPatternIsMissing', () => {
    expect(scoreAnswer(q, 'Has copyWith, version 2.13.5')).toBe(false);
  });

  test('shouldFailWhenARejectedPatternMatches', () => {
    expect(scoreAnswer(q, 'There is no copyWith. 2.17.2')).toBe(false);
  });

  test('shouldFailWhenAnswerIsMissing', () => {
    expect(scoreAnswer(q, undefined)).toBe(false);
  });
});

describe('totals', () => {
  test('shouldCountAllInputKindsInTotalTokens', () => {
    expect(totalTokens({ input: 1, cacheWrite: 2, cacheRead: 3, output: 4 })).toBe(10);
  });

  test('shouldAccumulateValuesAcrossTurns', () => {
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });
});

describe('deltas', () => {
  test('shouldTurnSessionCumulativeCostIntoPerTurnCost', () => {
    expect(deltas([0.01, 0.03, 0.06]).map((v) => +v.toFixed(2))).toEqual([0.01, 0.02, 0.03]);
  });
});

describe('mutatedFiles', () => {
  test('shouldListAddedAndChangedFilesWhenTreeDiffers', () => {
    const before = new Map([['a', '1'], ['b', '1']]);
    const after = new Map([['a', '1'], ['b', '2'], ['c', '1']]);
    expect(mutatedFiles(before, after).sort()).toEqual(['b', 'c']);
  });

  test('shouldReturnEmptyWhenTreeIsSame', () => {
    const tree = new Map([['a', '1']]);
    expect(mutatedFiles(tree, new Map(tree))).toEqual([]);
  });
});
