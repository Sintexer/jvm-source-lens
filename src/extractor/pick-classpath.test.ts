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
  test('single-module project: omitted modulePath uses root compileClasspath', () => {
    const base = minimalOutput();
    const r = pickResolvedConfiguration({ ...base, modules: [base.modules[0]!] }, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.module.name).toBe('root');
      expect(r.configuration.name).toBe('compileClasspath');
      expect(r.configuration.artifacts[0]?.name).toBe('a');
    }
  });

  test('multi-module: root does not shadow submodules when modulePath is omitted', () => {
    // A root project often has the configuration but an empty classpath; the agent then saw 0 matches.
    const r = pickResolvedConfiguration(minimalOutput(), {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_AMBIGUOUS');
      if (r.error.code === 'MODULE_AMBIGUOUS') {
        expect(r.error.modulePaths).toEqual(['root', ':lib']);
        expect(r.error.className).toBeUndefined();
      }
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
      modulePath: 'root',
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

  test('MODULE_NOT_FOUND for unknown module lists availableModules', () => {
    const r = pickResolvedConfiguration(minimalOutput(), { modulePath: ':nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_NOT_FOUND');
      if (r.error.code === 'MODULE_NOT_FOUND') {
        expect(r.error.availableModules).toEqual(['root', ':lib']);
        expect(r.error.message).toContain('Available modules');
      }
    }
  });

  test('when root lacks compileClasspath, uniquely picks the sole leaf module', () => {
    const out: ResolutionOutput = {
      ...minimalOutput(),
      modules: [
        { name: 'root', path: '/tmp/p', configurations: [] },
        {
          name: ':backend',
          path: '/tmp/p/backend',
          configurations: [
            {
              name: 'compileClasspath',
              scope: 'compile',
              artifacts: [artifact({ group: 'g', name: 'b', jarPath: '/b.jar' })],
            },
          ],
        },
      ],
    };
    const r = pickResolvedConfiguration(out, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.module.name).toBe(':backend');
      expect(r.configuration.name).toBe('compileClasspath');
    }
  });

  test('when root lacks config and multiple leaves have it, MODULE_AMBIGUOUS', () => {
    const out: ResolutionOutput = {
      ...minimalOutput(),
      modules: [
        { name: 'root', path: '/tmp/p', configurations: [] },
        {
          name: ':app',
          path: '/tmp/p/app',
          configurations: [
            {
              name: 'compileClasspath',
              scope: 'compile',
              artifacts: [artifact({ group: 'g', name: 'a', jarPath: '/a.jar' })],
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
              artifacts: [artifact({ group: 'g', name: 'l', jarPath: '/l.jar' })],
            },
          ],
        },
      ],
    };
    const r = pickResolvedConfiguration(out, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_AMBIGUOUS');
      if (r.error.code === 'MODULE_AMBIGUOUS') {
        expect(r.error.modulePaths).toEqual([':app', ':lib']);
        expect(r.error.className).toBeUndefined();
      }
    }
  });

  test('when no module has the config, CONFIGURATION_NOT_FOUND lists availableModules', () => {
    const out: ResolutionOutput = {
      ...minimalOutput(),
      modules: [
        { name: 'root', path: '/tmp/p', configurations: [] },
        { name: ':docs', path: '/tmp/p/docs', configurations: [] },
      ],
    };
    const r = pickResolvedConfiguration(out, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CONFIGURATION_NOT_FOUND');
      if (r.error.code === 'CONFIGURATION_NOT_FOUND') {
        expect(r.error.availableModules).toEqual(['root', ':docs']);
        expect(r.error.message).toContain('Available modules');
      }
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

describe('pickResolvedConfiguration loose modulePath', () => {
  function twoModules(): ResolutionOutput {
    const base = minimalOutput();
    const root = base.modules[0]!;
    return {
      ...base,
      modules: [root, { ...root, name: ':app', path: '/tmp/p/app' }, { ...root, name: ':core', path: '/tmp/p/core' }],
    };
  }

  test('accepts app / /app/ for :app', () => {
    for (const raw of ['app', '/app/', ':APP:']) {
      const r = pickResolvedConfiguration(twoModules(), { modulePath: raw });
      expect(r.ok && r.module.name).toBe(':app');
    }
  });

  test('unknown module lists available modules', () => {
    const r = pickResolvedConfiguration(twoModules(), { modulePath: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('MODULE_NOT_FOUND');
      expect(r.error.message).toContain(':app');
    }
  });
});

describe('pickResolvedConfiguration modulePath "*"', () => {
  test('behaves exactly like an omitted modulePath', () => {
    const omitted = pickResolvedConfiguration(minimalOutput(), {});
    for (const star of ['*', 'all']) {
      expect(pickResolvedConfiguration(minimalOutput(), { modulePath: star })).toEqual(omitted);
    }
  });
});

describe('pickResolvedConfiguration with a file path as modulePath', () => {
  test('absolute and project-relative source paths select the containing module', () => {
    for (const raw of ['/tmp/p/lib/src/main/java/com/x/Foo.java', 'lib/src/main/java/com/x/Foo.java']) {
      const r = pickResolvedConfiguration(minimalOutput(), { modulePath: raw });
      expect(r.ok && r.module.name).toBe(':lib');
    }
  });
});
