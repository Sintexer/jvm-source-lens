import { describe, expect, test } from 'bun:test';
import type { ResolutionOutput, ResolvedArtifact } from '../resolvers/resolution-output.js';
import { pickResolvedConfiguration } from './pick-classpath.js';

function artifact(partial: Partial<ResolvedArtifact> & Pick<ResolvedArtifact, 'group' | 'name'>): ResolvedArtifact {
  return {
    group: partial.group,
    name: partial.name,
    version: partial.version ?? '1.0',
    type: partial.type ?? 'jar',
    jarPath: partial.jarPath ?? null,
    sourcesJarPath: partial.sourcesJarPath ?? null,
    origin: partial.origin ?? 'external',
    direct: partial.direct ?? false,
    interproject: partial.interproject,
  };
}

function minimalOutput(): ResolutionOutput {
  return {
    schemaVersion: '1.1',
    resolvedAt: '2020-01-01T00:00:00Z',
    buildSystem: { type: 'gradle', version: '8.0', wrapper: true },
    projectRoot: '/tmp/p',
    modules: [
      {
        name: 'root',
        path: '/tmp/p',
        configurations: [
          {
            name: 'compileClasspath',
            scope: 'compile',
            artifacts: [artifact({ group: 'g', name: 'a', jarPath: '/x.jar' })],
          },
          {
            name: 'testCompileClasspath',
            scope: 'test-compile',
            artifacts: [artifact({ group: 'g', name: 't', jarPath: '/t.jar' })],
          },
        ],
      },
      {
        name: ':lib',
        path: '/tmp/p/lib',
        configurations: [
          {
            name: 'compileClasspath',
            scope: 'compile',
            artifacts: [artifact({ group: 'g', name: 'lib', jarPath: '/lib.jar' })],
          },
        ],
      },
    ],
    errors: [],
  };
}

describe('pickResolvedConfiguration', () => {
  test('defaults to root compileClasspath', () => {
    const r = pickResolvedConfiguration(minimalOutput(), {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.module.name).toBe('root');
      expect(r.configuration.name).toBe('compileClasspath');
      expect(r.configuration.artifacts[0]?.name).toBe('a');
    }
  });

  test('includeTest defaults configuration to testCompileClasspath', () => {
    const r = pickResolvedConfiguration(minimalOutput(), { includeTest: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.configuration.name).toBe('testCompileClasspath');
      expect(r.configuration.artifacts[0]?.name).toBe('t');
    }
  });

  test('explicit configuration overrides includeTest', () => {
    const r = pickResolvedConfiguration(minimalOutput(), {
      includeTest: true,
      configuration: 'compileClasspath',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.configuration.name).toBe('compileClasspath');
    }
  });

  test('selects submodule by modulePath', () => {
    const r = pickResolvedConfiguration(minimalOutput(), { modulePath: ':lib' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.module.name).toBe(':lib');
      expect(r.configuration.artifacts[0]?.name).toBe('lib');
    }
  });

  test('MODULE_NOT_FOUND for unknown module', () => {
    const r = pickResolvedConfiguration(minimalOutput(), { modulePath: ':nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_NOT_FOUND');
    }
  });

  test('includeTest falls back to jvmTestCompileClasspath when testCompileClasspath absent', () => {
    const out: ResolutionOutput = {
      ...minimalOutput(),
      modules: [
        {
          name: 'root',
          path: '/tmp/p',
          configurations: [
            {
              name: 'jvmCompileClasspath',
              scope: 'compile',
              artifacts: [artifact({ group: 'g', name: 'a', jarPath: '/x.jar' })],
            },
            {
              name: 'jvmTestCompileClasspath',
              scope: 'test-compile',
              artifacts: [artifact({ group: 'g', name: 't', jarPath: '/t.jar' })],
            },
          ],
        },
      ],
    };
    const r = pickResolvedConfiguration(out, { includeTest: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.configuration.name).toBe('jvmTestCompileClasspath');
    }
  });

  test('CONFIGURATION_NOT_FOUND when missing on module', () => {
    const r = pickResolvedConfiguration(minimalOutput(), {
      modulePath: ':lib',
      configuration: 'runtimeClasspath',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CONFIGURATION_NOT_FOUND');
    }
  });
});
