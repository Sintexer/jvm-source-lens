import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createCliProgressReporter } from './cli-progress.js';

describe('createCliProgressReporter', () => {
  const origIsTTY = process.stderr.isTTY;
  const stderrChunks: string[] = [];
  const origStderrWrite = process.stderr.write;
  const stderrLines: string[] = [];
  let origConsoleError: typeof console.error;

  beforeEach(() => {
    stderrChunks.length = 0;
    stderrLines.length = 0;
    origConsoleError = console.error;
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
    process.stderr.write = ((buf: string | Uint8Array, ...args: unknown[]) => {
      stderrChunks.push(typeof buf === 'string' ? buf : new TextDecoder().decode(buf));
      return true;
    }) as typeof process.stderr.write;
    console.error = ((msg: unknown) => {
      stderrLines.push(String(msg));
    }) as typeof console.error;
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    console.error = origConsoleError;
    Object.defineProperty(process.stderr, 'isTTY', { value: origIsTTY, configurable: true });
  });

  test('disabled reporter is a no-op', () => {
    const r = createCliProgressReporter(false);
    expect(() => {
      r.update('x');
      r.finishPhase();
      r.finalize();
    }).not.toThrow();
    expect(stderrChunks.length).toBe(0);
    expect(stderrLines.length).toBe(0);
  });

  test('non-TTY update uses console.error with prefix', () => {
    const r = createCliProgressReporter(true);
    r.update('Working…');
    expect(stderrLines).toContain('[jvmsrc] Working…');
  });
});
