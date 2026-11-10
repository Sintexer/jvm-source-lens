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
