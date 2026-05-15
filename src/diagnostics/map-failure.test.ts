import { expect, test } from 'bun:test';
import { mapPublicFailureToDiagnostic } from './map-failure.js';
import { FailureSeverity } from './failure-severity.js';

test('RESOLUTION_FAILED parse error maps to parser_fail', () => {
  const m = mapPublicFailureToDiagnostic(
    'RESOLUTION_FAILED',
    'Could not parse Gradle JSON output: unexpected token',
  );
  expect(m.severity).toBe(FailureSeverity.PARSER_FAIL);
  expect(m.errorCode).toBe('RESOLUTION_OUTPUT_PARSE_FAILED');
});

test('CLASS_NOT_FOUND is expected', () => {
  const m = mapPublicFailureToDiagnostic('CLASS_NOT_FOUND', 'not found');
  expect(m.severity).toBe(FailureSeverity.EXPECTED);
});
