import type { ClassSourceError } from './class-source-types.js';
import type {
  ResolutionOutput,
  ResolvedConfiguration,
  ResolvedModule,
} from '../resolvers/resolution-output.js';

export type PickClasspathOptions = {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
};

export type PickClasspathResult =
  | { ok: true; module: ResolvedModule; configuration: ResolvedConfiguration }
  | { ok: false; error: ClassSourceError };

function defaultConfigurationName(includeTest: boolean | undefined): string {
  return includeTest ? 'testCompileClasspath' : 'compileClasspath';
}

function pickConfiguration(
  module: ResolvedModule,
  name: string,
): ResolvedConfiguration | undefined {
  return module.configurations.find((c) => c.name === name);
}

export function pickResolvedConfiguration(
  output: ResolutionOutput,
  opts: PickClasspathOptions,
): PickClasspathResult {
  const wantModule = opts.modulePath;
  let module: ResolvedModule | undefined;
  if (wantModule !== undefined && wantModule.length > 0) {
    module = output.modules.find((m) => m.name === wantModule);
    if (module === undefined) {
      return {
        ok: false,
        error: {
          code: 'MODULE_NOT_FOUND',
          message: `No resolved module named ${JSON.stringify(wantModule)}`,
          modulePath: wantModule,
        },
      };
    }
  } else {
    module = output.modules.find((m) => m.name === 'root');
    if (module === undefined) {
      return {
        ok: false,
        error: {
          code: 'MODULE_NOT_FOUND',
          message: 'No root module in resolution output (expected name "root")',
          modulePath: 'root',
        },
      };
    }
  }

  const configName =
    opts.configuration !== undefined && opts.configuration.length > 0
      ? opts.configuration
      : defaultConfigurationName(opts.includeTest);

  const configuration = pickConfiguration(module, configName);
  if (configuration === undefined) {
    return {
      ok: false,
      error: {
        code: 'CONFIGURATION_NOT_FOUND',
        message: `Module ${JSON.stringify(module.name)} has no configuration ${JSON.stringify(configName)}`,
        moduleName: module.name,
        configuration: configName,
      },
    };
  }

  return { ok: true, module, configuration };
}
