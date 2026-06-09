import { describe, expect, test } from 'bun:test';
import { gradleVersionToMaxJava, gradleVersionToMinJava } from './detect-required-version.js';

describe('gradleVersionToMinJava', () => {
  test('maps known Gradle baselines to minimum Java', () => {
    expect(gradleVersionToMinJava('7.4.2')).toBe(8);
    expect(gradleVersionToMinJava('8.7')).toBe(8);
    expect(gradleVersionToMinJava('8.8')).toBe(17);
    expect(gradleVersionToMinJava('9.0')).toBe(17);
  });
});

describe('gradleVersionToMaxJava', () => {
  test('maps older wrappers to conservative max Java', () => {
    expect(gradleVersionToMaxJava('7.4.2')).toBe(17);
    expect(gradleVersionToMaxJava('8.3')).toBe(20);
    expect(gradleVersionToMaxJava('8.6')).toBe(21);
    expect(gradleVersionToMaxJava('8.8')).toBe(22);
    expect(gradleVersionToMaxJava('9.0')).toBe(25);
  });

  test('returns null for invalid version strings', () => {
    expect(gradleVersionToMaxJava('not-a-version')).toBeNull();
  });
});
