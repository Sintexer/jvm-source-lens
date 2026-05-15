import type { ResolutionOutput } from './resolvers/resolution-output.js';

export type ListModulesConfigurationRow = {
  name: string;
  scope: 'compile' | 'runtime' | 'test-compile' | 'test-runtime';
  artifactCount: number;
  directArtifactCount: number;
};

export type ListModulesModuleRow = {
  name: string;
  path: string;
  configurations: ListModulesConfigurationRow[];
};

export type ListModulesPayloadData = {
  projectRoot: string;
  resolvedAt: string;
  schemaVersion: string;
  buildSystem: ResolutionOutput['buildSystem'];
  modules: ListModulesModuleRow[];
  resolutionWarningCount: number;
};

export function buildListModulesPayload(output: ResolutionOutput): ListModulesPayloadData {
  const modules: ListModulesModuleRow[] = output.modules.map((m) => ({
    name: m.name,
    path: m.path,
    configurations: m.configurations.map((c) => ({
      name: c.name,
      scope: c.scope,
      artifactCount: c.artifacts.length,
      directArtifactCount: c.artifacts.filter((a) => a.direct).length,
    })),
  }));

  return {
    projectRoot: output.projectRoot,
    resolvedAt: output.resolvedAt,
    schemaVersion: output.schemaVersion,
    buildSystem: output.buildSystem,
    modules,
    resolutionWarningCount: output.errors.length,
  };
}
