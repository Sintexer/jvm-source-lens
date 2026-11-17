import { describe, expect, test } from 'bun:test';
import { classifyClassSourceError } from './error-messages.js';

const query = { projectRoot: '/tmp/proj' };

describe('classifyClassSourceError FIND_QUERY_INVALID', () => {
  test('shouldKeepTimeoutMessageWhenRegexTimesOut', () => {
    const detail =
      'Regex timed out after 500 ms (JVMSRC_REGEX_TIMEOUT_MS). Simplify the pattern or search with regex: false.';
    const classified = classifyClassSourceError({ code: 'FIND_QUERY_INVALID', message: detail }, query);

    expect(classified.payload.message).toBe(detail);
    expect(classified.payload.message).not.toContain('non-empty literal');
    expect(classified.payload.message.includes(classified.summary)).toBe(true);
  });

  test('shouldAppendPatternHintWhenRegexIsInvalid', () => {
    const classified = classifyClassSourceError(
      { code: 'FIND_QUERY_INVALID', message: 'Invalid regex: Unterminated group' },
      query,
    );

    expect(classified.payload.message).toContain('Invalid regex: Unterminated group');
    expect(classified.payload.message).toContain('non-empty literal');
  });
});

describe('classifyClassSourceError SOURCE_OUTPUT_TOO_LARGE', () => {
  test('shouldStateLimitAndHintOnceWhenFullSourceIsTooLarge', async () => {
    const { checkUnscopedFullSourceSize } = await import('../output-limits.js');
    const check = checkUnscopedFullSourceSize('p.Big', 'x'.repeat(70_000));
    if (check.ok) throw new Error('expected refusal');
    const classified = classifyClassSourceError(
      { code: 'SOURCE_OUTPUT_TOO_LARGE', message: check.message, className: 'p.Big', charLength: check.charLength, maxChars: check.maxChars },
      query,
    );
    const text = classified.payload.message;
    expect(text.includes(classified.summary)).toBe(true);
    expect(text.split(String(check.maxChars)).length - 1).toBe(1);
    expect(text.split('methodNames').length - 1).toBe(1);
    expect(text).toContain('get_class_structure');
  });
});

describe('classifyClassSourceError MODULE_NOT_FOUND', () => {
  test('shouldNameResolveDependenciesWithoutJsonPathWhenNoModulesAreListed', () => {
    const classified = classifyClassSourceError({ code: 'MODULE_NOT_FOUND', message: 'x', modulePath: ':nope' } as never, query);
    expect(classified.payload.message).not.toContain('resolution.modules[]');
    expect(classified.payload.message).toContain('resolve_dependencies');
  });
});
