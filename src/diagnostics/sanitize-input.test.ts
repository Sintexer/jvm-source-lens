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

test('shouldKeepShortStringArraysWhenSanitizingMethodNames', () => {
  const out = sanitizeDiagnosticInput({ methodNames: ['write', 'flush', 42, 'x'.repeat(500)], other: 1 });
  expect(out.methodNames).toEqual(['write', 'flush', 'x'.repeat(200)]);
  expect(out.other).toBeUndefined();
});

test('shouldCapArrayLengthWhenMethodNamesHuge', () => {
  const names = Array.from({ length: 50 }, (_, i) => `m${i}`);
  expect((sanitizeDiagnosticInput({ methodNames: names }).methodNames as string[]).length).toBe(20);
});
