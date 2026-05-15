import { afterEach, describe, expect, test } from 'bun:test';
import { writeCliGetResult } from './cli-get-output.js';

const stderrMessages: string[] = [];
const stdoutJsonLines: string[] = [];
const origConsoleError = console.error;
const origConsoleLog = console.log;

afterEach(() => {
  console.error = origConsoleError;
  console.log = origConsoleLog;
  stderrMessages.length = 0;
  stdoutJsonLines.length = 0;
  process.exitCode = 0;
});

function captureConsoleError(): void {
  stderrMessages.length = 0;
  console.error = ((msg: string) => {
    stderrMessages.push(msg);
  }) as typeof console.error;
}

function captureConsoleLog(): void {
  stdoutJsonLines.length = 0;
  console.log = ((msg: string) => {
    stdoutJsonLines.push(msg);
  }) as typeof console.log;
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

  test('writes decompiled metadata to stderr', () => {
    captureConsoleError();
    writeCliGetResult({
      ok: true,
      source: 'class Foo {}\n',
      sourceAvailable: false,
      className: 'com.example.Foo',
      provenance: {
        kind: 'decompiled',
        coordinates: { group: 'g', name: 'a', version: '1' },
        jarPath: '/tmp/a.jar',
        entryRelPath: 'com/example/Foo.class',
        cachePath: '/cache/jvmsrc/decompiled/g/a/1/Foo.java',
      },
    });
    expect(stderrMessages.length).toBe(1);
    expect(stderrMessages[0]).toContain('"sourceAvailable":false');
    expect(stderrMessages[0]).toContain('"kind":"decompiled"');
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

  test('json mode writes one JSON object to stdout on success; nothing to stderr', () => {
    captureConsoleError();
    captureConsoleLog();
    writeCliGetResult(successResult, { json: true });
    expect(stderrMessages.length).toBe(0);
    expect(stdoutJsonLines.length).toBe(1);
    const parsed = JSON.parse(stdoutJsonLines[0]!) as {
      source: string;
      sourceAvailable: boolean;
      className: string;
      provenance: unknown;
    };
    expect(parsed.source).toBe(successResult.source);
    expect(parsed.sourceAvailable).toBe(true);
    expect(parsed.className).toBe('com.example.Foo');
    expect(parsed.provenance).toEqual(successResult.provenance);
  });

  test('json mode writes error JSON to stdout only', () => {
    captureConsoleError();
    captureConsoleLog();
    writeCliGetResult(
      {
        ok: false,
        error: { code: 'CLASS_NOT_FOUND', message: 'nope', className: 'x', searchedArtifactCount: 0 },
      },
      { json: true },
    );
    expect(stderrMessages.length).toBe(0);
    expect(stdoutJsonLines.length).toBe(1);
    const parsed = JSON.parse(stdoutJsonLines[0]!) as { error: boolean; code: string; message: string };
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('CLASS_NOT_FOUND');
    expect(parsed.message).toBe('nope');
  });
});
