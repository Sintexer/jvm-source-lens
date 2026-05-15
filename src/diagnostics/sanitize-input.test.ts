import { expect, test } from 'bun:test';
import { redactSecretsInString, sanitizeDiagnosticInput } from './sanitize-input.js';

test('redactSecretsInString redacts bearer token', () => {
  expect(redactSecretsInString('Authorization: Bearer secret-token-here')).toContain('[redacted]');
});

test('sanitizeDiagnosticInput allowlists keys only', () => {
  expect(
    sanitizeDiagnosticInput({
      projectRoot: '/x',
      password: 'nope',
      className: 'c',
    }),
  ).toEqual({ projectRoot: '/x', className: 'c' });
});
