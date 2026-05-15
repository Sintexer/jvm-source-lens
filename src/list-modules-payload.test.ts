import { expect, test } from 'bun:test';
import { buildListModulesPayload } from './list-modules-payload.js';
import type { ResolutionOutput } from './resolvers/resolution-output.js';

test('buildListModulesPayload maps modules and dependency counts', () => {
  const output: ResolutionOutput = {
    schemaVersion: '1.1',
    resolvedAt: '2026-05-15T12:00:00Z',
    buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
    projectRoot: '/tmp/proj',
    errors: [{ module: ':a', message: 'warn', fatal: false }],
    modules: [
      {
        name: ':app',
        path: '/tmp/proj/app',
        configurations: [
          {
            name: 'compileClasspath',
            scope: 'compile',
            artifacts: [
              {
                group: 'g',
                name: 'direct',
                version: '1',
                type: 'jar',
                jarPath: '/j1.jar',
                sourcesJarPath: null,
                origin: 'external',
                direct: true,
              },
              {
                group: 'g',
                name: 'trans',
                version: '2',
                type: 'jar',
                jarPath: '/j2.jar',
                sourcesJarPath: null,
                origin: 'external',
                direct: false,
              },
            ],
          },
        ],
      },
      {
        name: 'root',
        path: '/tmp/proj',
        configurations: [],
      },
    ],
  };

  const p = buildListModulesPayload(output);
  expect(p.resolutionWarningCount).toBe(1);
  expect(p.modules).toHaveLength(2);
  const appModule = p.modules.find((m) => m.name === ':app');
  const rootModule = p.modules.find((m) => m.name === 'root');
  expect(appModule?.configurations[0]).toEqual({
    name: 'compileClasspath',
    scope: 'compile',
    artifactCount: 2,
    directArtifactCount: 1,
  });
  expect(rootModule?.configurations).toEqual([]);
});
