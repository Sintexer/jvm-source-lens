import { describe, expect, test } from 'bun:test';
import { formatGradleUserMessage } from './gradle-failure-message.js';

describe('formatGradleUserMessage', () => {
  test('timeout appends JVMSRC_GRADLE_TIMEOUT_MS hint', () => {
    const m = formatGradleUserMessage({
      task: 'jvmsrcResolve',
      kind: 'timeout',
      message: 'Gradle timed out after 1ms (task jvmsrcResolve)',
      command: ['/tmp/gradlew'],
      usedWrapper: true,
    });
    expect(m).toContain('Gradle timed out');
    expect(m).toContain('JVMSRC_GRADLE_TIMEOUT_MS');
  });

  test('spawn without wrapper suggests PATH or gradlew', () => {
    const m = formatGradleUserMessage({
      task: 'jvmsrcResolve',
      kind: 'spawn',
      message: 'Failed to start Gradle: ENOENT',
      command: ['gradle'],
      usedWrapper: false,
    });
    expect(m).toContain('Gradle wrapper');
    expect(m).toContain('PATH');
  });

  test('spawn with wrapper leaves message unchanged', () => {
    const base = 'Failed to start Gradle: boom';
    const m = formatGradleUserMessage({
      task: 'jvmsrcResolve',
      kind: 'spawn',
      message: base,
      command: ['/p/gradlew'],
      usedWrapper: true,
    });
    expect(m).toBe(base);
  });

  test('exit with 401 appends auth hint', () => {
    const m = formatGradleUserMessage({
      task: 'jvmsrcResolveSources',
      kind: 'exit',
      message: 'Gradle exited with code 1',
      stderr: 'Could not GET https://repo.example.com/lib.jar. Received status code 401 from server: Unauthorized',
      command: ['gradle'],
      usedWrapper: true,
    });
    expect(m).toContain('Gradle exited with code 1');
    expect(m).toContain('gradle.properties');
  });

  test('exit with JAVA_HOME appends jdk hint', () => {
    const m = formatGradleUserMessage({
      task: 'jvmsrcResolve',
      kind: 'exit',
      message: 'Gradle exited with code 1',
      stderr: 'JAVA_HOME is set to an invalid directory: /nope',
      command: ['gradle'],
      usedWrapper: true,
    });
    expect(m).toContain('JAVA_HOME');
  });

  test('exit scans stdout when stderr empty', () => {
    const m = formatGradleUserMessage({
      task: 'jvmsrcResolve',
      kind: 'exit',
      message: 'Gradle exited with code 1',
      stdout: 'invalid source release: 99',
      command: ['gradle'],
      usedWrapper: true,
    });
    expect(m).toContain('JDK');
  });
});
