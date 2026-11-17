import { describe, expect, test } from 'bun:test';
import { matchingClose, skipAngle, skipKotlinNoise, splitTopLevel } from './kotlin-lexer.js';

describe('skipKotlinNoise', () => {
  test('shouldSkipNestedBlockComments', () => {
    const s = '/* a /* b */ c */ x';
    expect(skipKotlinNoise(s, 0)).toBe(s.indexOf(' x'));
  });

  test('shouldStopAtNewlineWhenLineCommentEnds', () => {
    const s = '// hi { \nfoo';
    expect(skipKotlinNoise(s, 0)).toBe(s.indexOf('\n'));
  });

  test('shouldSkipStringTemplatesThatContainQuotesAndBraces', () => {
    const s = '"a ${ "}" } b" x';
    expect(skipKotlinNoise(s, 0)).toBe(s.lastIndexOf(' x'));
  });

  test('shouldSkipRawStringsAndCharLiterals', () => {
    const raw = '"""a "quoted" { b""" x';
    expect(skipKotlinNoise(raw, 0)).toBe(raw.lastIndexOf(' x'));
    expect(skipKotlinNoise("'\\'' x", 0)).toBe(4);
    expect(skipKotlinNoise("'{' x", 0)).toBe(3);
  });

  test('shouldReturnTheSameIndexForPlainCode', () => {
    expect(skipKotlinNoise('fun x', 0)).toBe(0);
  });
});

describe('matchingClose', () => {
  test('shouldIgnoreBracesInStringsAndComments', () => {
    const s = '{ val a = "}" // }\n /* } */ if (x) { y } }';
    expect(matchingClose(s, 0, '{', '}')).toBe(s.length - 1);
  });

  test('shouldReturnMinusOneWhenUnbalanced', () => {
    expect(matchingClose('{ {', 0, '{', '}')).toBe(-1);
  });
});

describe('skipAngle', () => {
  test('shouldIgnoreArrowsInsideTypeArguments', () => {
    const s = '<T : (A) -> B, C<D>> rest';
    expect(skipAngle(s, 0)).toBe(s.indexOf(' rest'));
  });
});

describe('splitTopLevel', () => {
  test('shouldSplitOnlyOnTopLevelCommas', () => {
    const parts = splitTopLevel('a: Map<K, V>, b: (Int, Int) -> Unit = { x, y -> x }, c: String = "a,b"');
    expect(parts.map((p) => p.text.trim())).toEqual([
      'a: Map<K, V>',
      'b: (Int, Int) -> Unit = { x, y -> x }',
      'c: String = "a,b"',
    ]);
  });

  test('shouldKeepOffsetsRelativeToTheText', () => {
    const text = 'a, bb';
    const parts = splitTopLevel(text);
    expect(text.slice(parts[1]!.start, parts[1]!.end).trim()).toBe('bb');
  });
});
