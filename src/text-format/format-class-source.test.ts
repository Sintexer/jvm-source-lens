import { describe, expect, test } from 'bun:test';
import type { ClassSourceLookupResult } from '../extractor/class-source-types.js';
import { formatClassSourceCompactText } from './format-class-source.js';

function successResult(
  overrides: Partial<Extract<ClassSourceLookupResult, { ok: true }>> = {},
): Extract<ClassSourceLookupResult, { ok: true }> {
  return {
    ok: true,
    source: 'public void ownMethod() {}',
    sourceAvailable: true,
    className: 'q.Child',
    provenance: { kind: 'sourcesJar', coordinates: { group: 'g', name: 'n', version: '1' }, jarPath: '/x.jar' },
    ...overrides,
  };
}

describe('formatClassSourceCompactText', () => {
  test('mentions inherited methods and their declaringClass', () => {
    const result = successResult({
      excerpt: {
        excerpted: true,
        requestedMethodNames: ['ownMethod', 'inheritedMethod'],
        matchedMethodNames: ['ownMethod', 'inheritedMethod'],
        unmatchedMethodNames: [],
        lineNumbersReliable: true,
        sourceLineCount: 5,
        inheritedExcerpts: [{ methodName: 'inheritedMethod', declaringClass: 'q.Parent' }],
      },
    });
    const text = formatClassSourceCompactText(result);
    expect(text).toContain('inherited from: inheritedMethod (q.Parent)');
  });

  test('omits inherited note when nothing was inherited', () => {
    const result = successResult({
      excerpt: {
        excerpted: true,
        requestedMethodNames: ['ownMethod'],
        matchedMethodNames: ['ownMethod'],
        unmatchedMethodNames: [],
        lineNumbersReliable: true,
        sourceLineCount: 5,
      },
    });
    const text = formatClassSourceCompactText(result);
    expect(text).not.toContain('inherited from');
  });
});
