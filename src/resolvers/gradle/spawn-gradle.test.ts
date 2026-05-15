import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_GRADLE_TIMEOUT_MS, gradleTimeoutMs } from './spawn-gradle.js';

describe('gradleTimeoutMs', () => {
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    } else {
      process.env.JVMSRC_GRADLE_TIMEOUT_MS = saved;
    }
  });

  test('defaults to DEFAULT_GRADLE_TIMEOUT_MS', () => {
    saved = process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    delete process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    expect(gradleTimeoutMs()).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
  });

  test('parses positive JVMSRC_GRADLE_TIMEOUT_MS', () => {
    saved = process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    process.env.JVMSRC_GRADLE_TIMEOUT_MS = '12345';
    expect(gradleTimeoutMs()).toBe(12345);
  });

  test('invalid env falls back to default', () => {
    saved = process.env.JVMSRC_GRADLE_TIMEOUT_MS;
    process.env.JVMSRC_GRADLE_TIMEOUT_MS = '0';
    expect(gradleTimeoutMs()).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
  });
});
