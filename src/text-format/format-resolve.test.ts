import { describe, expect, test } from 'bun:test';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { formatArtifactVersionsText, formatResolutionSummaryText } from './format-resolve.js';

const art = (group: string, name: string, version: string | null, origin: ResolvedArtifact['origin'] = 'external'): ResolvedArtifact => ({
  group,
  name,
  version,
  type: 'jar',
  jarPath: null,
  sourcesJarPath: null,
  origin,
  direct: false,
});

const output: ResolutionOutput = {
  schemaVersion: '1.1',
  resolvedAt: '2020-01-01T00:00:00Z',
  buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
  projectRoot: '/p',
  modules: [
    {
      name: ':app',
      path: '/p/app',
      configurations: [
        {
          name: 'compileClasspath',
          scope: 'compile',
          artifacts: [art('com.fasterxml.jackson.core', 'jackson-databind', '2.15.2'), art('g', 'other', '1')],
        },
      ],
    },
    {
      name: ':worker',
      path: '/p/worker',
      configurations: [
        {
          name: 'compileClasspath',
          scope: 'compile',
          artifacts: [
            art('com.fasterxml.jackson.core', 'jackson-databind', '2.14.0'),
            art('project', 'app', null, 'interproject'),
          ],
        },
      ],
    },
  ],
  errors: [],
};

describe('formatArtifactVersionsText', () => {
  test('lists versions per module and flags conflicts', () => {
    const text = formatArtifactVersionsText(output, 'jackson').join('\n');
    expect(text).toContain('com.fasterxml.jackson.core:jackson-databind');
    expect(text).toContain('⚠ 2 versions');
    expect(text).toContain('2.14.0 [:worker]');
    expect(text).toContain('2.15.2 [:app]');
    expect(text).not.toContain('g:other');
  });

  test('words are AND-ed and inter-project edges skipped', () => {
    expect(formatArtifactVersionsText(output, 'jackson 2.15').join('\n')).not.toContain('2.14.0');
    expect(formatArtifactVersionsText(output, 'project').join('\n')).toContain('(none)');
  });
});

describe('formatResolutionSummaryText hints', () => {
  test('mcp audience points at query, never at full=true', () => {
    const text = formatResolutionSummaryText(output, { audience: 'mcp' });
    expect(text).toContain('Pass query');
    expect(text).not.toContain('full=true');
  });

  test('query appends the artifact listing', () => {
    expect(formatResolutionSummaryText(output, { audience: 'mcp', artifactQuery: 'other' })).toContain('g:other');
  });
});
