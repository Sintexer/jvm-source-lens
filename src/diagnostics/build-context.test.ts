import { expect, test } from 'bun:test';
import { buildDiagnosticContextSync } from './build-context.js';

test('buildDiagnosticContextSync skips java -version when includeJavaVersion is false', () => {
  const t0 = performance.now();
  const ctx = buildDiagnosticContextSync({
    projectRoot: '/nope',
    buildSystem: null,
    includeJavaVersion: false,
  });
  const elapsed = performance.now() - t0;
  expect(ctx.javaVersion).toBeNull();
  expect(elapsed).toBeLessThan(500);
});
