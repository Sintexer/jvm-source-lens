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

const COMPILE_CONFIGURATION_CANDIDATES = ['compileClasspath', 'jvmCompileClasspath'] as const;
const TEST_CONFIGURATION_CANDIDATES = ['testCompileClasspath', 'jvmTestCompileClasspath'] as const;

function configurationCandidates(
  explicitName: string | undefined,
  includeTest: boolean | undefined,
): readonly string[] {
  if (explicitName !== undefined && explicitName.length > 0) {
    return [explicitName];
  }
  return includeTest ? TEST_CONFIGURATION_CANDIDATES : COMPILE_CONFIGURATION_CANDIDATES;
}

function pickConfiguration(
  module: ResolvedModule,
  names: readonly string[],
): ResolvedConfiguration | undefined {
  for (const name of names) {
    const hit = module.configurations.find((c) => c.name === name);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
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

  const candidates = configurationCandidates(opts.configuration, opts.includeTest);
  const configuration = pickConfiguration(module, candidates);
  if (configuration === undefined) {
    const wanted = candidates.join(' or ');
    return {
      ok: false,
      error: {
        code: 'CONFIGURATION_NOT_FOUND',
        message: `Module ${JSON.stringify(module.name)} has none of: ${wanted}`,
        moduleName: module.name,
        configuration: candidates[0] ?? 'compileClasspath',
      },
    };
  }

  return { ok: true, module, configuration };
}
