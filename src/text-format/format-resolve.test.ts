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
  test('default lists versions with module counts only and flags conflicts', () => {
    const text = formatArtifactVersionsText(output, 'jackson').join('\n');
    expect(text).toContain('com.fasterxml.jackson.core:jackson-databind');
    expect(text).toContain('⚠ 2 versions');
    expect(text).toContain('2.14.0 (1 module)');
    expect(text).toContain('2.15.2 (1 module)');
    expect(text).not.toContain(':worker');
    expect(text).not.toContain('g:other');
  });

  test('modules="all" names every module', () => {
    const text = formatArtifactVersionsText(output, 'jackson', 'all').join('\n');
    expect(text).toContain('2.14.0 (1 module: :worker)');
    expect(text).toContain('2.15.2 (1 module: :app)');
  });

  test('modules filter restricts scope and names modules', () => {
    const text = formatArtifactVersionsText(output, 'jackson', ':app').join('\n');
    expect(text).toContain('2.15.2 (1 module: :app)');
    expect(text).not.toContain('2.14.0');
    expect(text).not.toContain('⚠');
  });

  test('stays small on a many-module build by default and caps names per version', () => {
    const many: ResolutionOutput = {
      ...output,
      modules: Array.from({ length: 160 }, (_, i) => ({
        name: `:svc:m${i}`,
        path: `/p/m${i}`,
        configurations: [
          { name: 'compileClasspath', scope: 'compile' as const, artifacts: [art('g', 'lib', i % 2 ? '1' : '2')] },
        ],
      })),
    };
    const brief = formatArtifactVersionsText(many, 'lib').join('\n');
    expect(brief).toContain('1 (80 modules)');
    expect(brief.length).toBeLessThan(400);
    expect(formatArtifactVersionsText(many, 'lib', ':svc').join('\n')).toContain('… +55 more');
    expect(formatArtifactVersionsText(many, 'lib', 'all').join('\n')).not.toContain('more');
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
    const text = formatResolutionSummaryText(output, { audience: 'mcp', artifactQuery: 'other' });
    expect(text).toContain('g:other');
    expect(text).not.toContain('Modules (');
  });
});
