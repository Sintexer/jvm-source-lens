import { expect, test } from 'bun:test';
import { appendGuidanceFooter, outcomeOnlySuccessFields } from '../guided-response/envelope.js';
import { buildClassNotFoundMessage, buildSearchClassesEmptyMessage } from './empty-messages.js';

test('buildClassNotFoundMessage suggests search_classes for simple names', () => {
  const msg = buildClassNotFoundMessage({
    className: 'MyUtil',
    searchedArtifactCount: 3,
    includeTest: false,
  });
  expect(msg).toContain('search_classes');
  expect(msg).not.toContain('not searched');
});

test('buildSearchClassesEmptyMessage mentions broadening query', () => {
  const msg = buildSearchClassesEmptyMessage({ query: 'MissingType' });
  expect(msg).toContain('No classes matched');
  expect(msg).toContain('resolve_dependencies');
});

test('appendGuidanceFooter skips footer when no message', () => {
  const out = appendGuidanceFooter('body', outcomeOnlySuccessFields(true));
  expect(out).toBe('body');
});

test('appendGuidanceFooter includes message line when guided', () => {
  const out = appendGuidanceFooter('body', {
    message: 'Retry with includeTest: true.',
    errorCategory: null,
    found: false,
    querySucceeded: true,
  });
  expect(out).toContain('---');
  expect(out).toContain('message: Retry with includeTest: true.');
  expect(out).toContain('found: false');
});
