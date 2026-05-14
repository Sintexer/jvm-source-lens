import { describe, expect, test } from 'bun:test';
import { parseResolutionJson, validateResolutionOutput } from './resolution-output.js';

describe('resolution-output', () => {
  test('parseResolutionJson accepts trimmed JSON', () => {
    const doc = {
      schemaVersion: '1.0',
      resolvedAt: '2026-01-01T00:00:00Z',
      buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
      projectRoot: '/proj',
      modules: [],
      errors: [],
    };
    const raw = parseResolutionJson(JSON.stringify(doc));
    const v = validateResolutionOutput(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.output.projectRoot).toBe('/proj');
    }
  });

  test('parseResolutionJson extracts object when surrounded by text', () => {
    const inner = JSON.stringify({
      schemaVersion: '1.0',
      resolvedAt: 'x',
      buildSystem: { type: 'gradle', version: '8', wrapper: false },
      projectRoot: '/p',
      modules: [],
      errors: [],
    });
    const raw = parseResolutionJson(`noise\n${inner}\ntrailer`);
    const v = validateResolutionOutput(raw);
    expect(v.ok).toBe(true);
  });

  test('validate rejects unsupported schemaVersion', () => {
    const v = validateResolutionOutput({
      schemaVersion: '0.9',
      resolvedAt: 'x',
      buildSystem: { type: 'gradle', version: '8', wrapper: true },
      projectRoot: '/p',
      modules: [],
      errors: [],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toContain('schemaVersion');
    }
  });
});
