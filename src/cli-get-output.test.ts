import { afterEach, describe, expect, test } from 'bun:test';
import { writeCliGetResult } from './cli-get-output.js';

const stderrMessages: string[] = [];
const origConsoleError = console.error;

afterEach(() => {
  console.error = origConsoleError;
  stderrMessages.length = 0;
});

function captureConsoleError(): void {
  stderrMessages.length = 0;
  console.error = ((msg: string) => {
    stderrMessages.push(msg);
  }) as typeof console.error;
}

const successResult = {
  ok: true as const,
  source: 'class Foo {}\n',
  sourceAvailable: true as const,
  className: 'com.example.Foo',
  provenance: {
    kind: 'sourcesJar' as const,
    coordinates: { group: 'g', name: 'a', version: '1' },
    jarPath: '/tmp/a-sources.jar',
  },
};

describe('writeCliGetResult', () => {
  test('writes metadata to stderr by default', () => {
    captureConsoleError();
    writeCliGetResult(successResult);
    expect(stderrMessages.length).toBe(1);
    expect(stderrMessages[0]).toContain('"sourceAvailable":true');
  });

  test('quiet mode skips success metadata on stderr', () => {
    captureConsoleError();
    writeCliGetResult(successResult, { quiet: true });
    expect(stderrMessages.length).toBe(0);
  });

  test('quiet mode still writes errors to stderr', () => {
    captureConsoleError();
    writeCliGetResult(
      {
        ok: false,
        error: { code: 'CLASS_NOT_FOUND', message: 'nope', className: 'x', searchedArtifactCount: 0 },
      },
      { quiet: true },
    );
    expect(stderrMessages.length).toBe(1);
    expect(stderrMessages[0]).toContain('"error":true');
  });
});
