import { expect, test } from 'bun:test';
import { appendGuidanceFooter, outcomeOnlySuccessFields } from '../guided-response/envelope.js';
import {
  buildClassNotFoundMessage,
  buildFindInClassNoMatchMessage,
  buildSearchClassesEmptyMessage,
} from './empty-messages.js';

test('buildClassNotFoundMessage suggests search_classes for simple names', () => {
  const msg = buildClassNotFoundMessage({
    className: 'MyUtil',
    searchedArtifactCount: 3,
    includeTest: false,
  });
  expect(msg).toContain('search_classes');
  expect(msg).not.toContain('not searched');
});

test('buildClassNotFoundMessage includes did-you-mean suggestions', () => {
  const msg = buildClassNotFoundMessage({
    className: 'com.example.Foo',
    searchedArtifactCount: 2,
    suggestions: ['com.example.v2.Foo'],
  });
  expect(msg).toContain('Did you mean: com.example.v2.Foo?');
});

test('buildClassNotFoundMessage lists suggestedModulePaths when omitted on multimodule', () => {
  const msg = buildClassNotFoundMessage({
    className: 'com.example.Foo',
    searchedArtifactCount: 2,
    suggestedModulePaths: [':app', ':lib'],
  });
  expect(msg).toContain('modulePath was omitted');
  expect(msg).toContain('":app"');
  expect(msg).toContain('":lib"');
});

test('buildSearchClassesEmptyMessage mentions broadening query', () => {
  const msg = buildSearchClassesEmptyMessage({ query: 'MissingType' });
  expect(msg).toContain('No classes matched');
  expect(msg).toContain('resolve_dependencies');
});

test('buildSearchClassesEmptyMessage method-like query mentions search_in_artifact', () => {
  const msg = buildSearchClassesEmptyMessage({ query: 'handleOrderRestateEvent' });
  expect(msg).toContain('search_in_artifact');
  expect(msg).toContain('method name');
});

test('buildFindInClassNoMatchMessage regex mode states regex was used', () => {
  const msg = buildFindInClassNoMatchMessage({
    className: 'com.example.Foo',
    query: 'a|b',
    regex: true,
    sourceAvailable: true,
  });
  expect(msg).toContain('regex: true');
  expect(msg).toContain('literal');
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
