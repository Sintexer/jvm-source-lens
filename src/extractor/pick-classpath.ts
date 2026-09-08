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

const AVAILABLE_MODULES_MESSAGE_CAP = 12;

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

function listModuleNames(output: ResolutionOutput): string[] {
  return output.modules.map((m) => m.name);
}

function formatAvailableModulesHint(names: string[]): string {
  if (names.length === 0) {
    return '';
  }
  const listed = names.slice(0, AVAILABLE_MODULES_MESSAGE_CAP);
  const more =
    names.length > AVAILABLE_MODULES_MESSAGE_CAP
      ? ` (and ${names.length - AVAILABLE_MODULES_MESSAGE_CAP} more)`
      : '';
  const example = listed.find((n) => n !== 'root') ?? listed[0]!;
  return (
    ` Available modules: [${listed.map((n) => JSON.stringify(n)).join(', ')}]${more}.` +
    ` Retry with modulePath: ${JSON.stringify(example)}.`
  );
}

/**
 * When `modulePath` is omitted: prefer `root` if it has the wanted config; otherwise uniquely
 * pick the sole module that has it; if several match, return MODULE_AMBIGUOUS; if none,
 * CONFIGURATION_NOT_FOUND with availableModules.
 */
export function pickResolvedConfiguration(
  output: ResolutionOutput,
  opts: PickClasspathOptions,
): PickClasspathResult {
  const candidates = configurationCandidates(opts.configuration, opts.includeTest);
  const availableModules = listModuleNames(output);
  const wantModule = opts.modulePath;

  if (wantModule !== undefined && wantModule.length > 0) {
    const module = output.modules.find((m) => m.name === wantModule);
    if (module === undefined) {
      return {
        ok: false,
        error: {
          code: 'MODULE_NOT_FOUND',
          message:
            `No resolved module named ${JSON.stringify(wantModule)}.` +
            formatAvailableModulesHint(availableModules),
          modulePath: wantModule,
          availableModules,
        },
      };
    }
    const configuration = pickConfiguration(module, candidates);
    if (configuration === undefined) {
      const wanted = candidates.join(' or ');
      return {
        ok: false,
        error: {
          code: 'CONFIGURATION_NOT_FOUND',
          message:
            `Module ${JSON.stringify(module.name)} has none of: ${wanted}.` +
            formatAvailableModulesHint(availableModules),
          moduleName: module.name,
          configuration: candidates[0] ?? 'compileClasspath',
          availableModules,
        },
      };
    }
    return { ok: true, module, configuration };
  }

  const root = output.modules.find((m) => m.name === 'root');
  if (root !== undefined) {
    const rootConfig = pickConfiguration(root, candidates);
    if (rootConfig !== undefined) {
      return { ok: true, module: root, configuration: rootConfig };
    }
  }

  const withConfig: { module: ResolvedModule; configuration: ResolvedConfiguration }[] = [];
  for (const module of output.modules) {
    if (module.name === 'root') {
      continue;
    }
    const configuration = pickConfiguration(module, candidates);
    if (configuration !== undefined) {
      withConfig.push({ module, configuration });
    }
  }

  if (withConfig.length === 1) {
    const only = withConfig[0]!;
    return { ok: true, module: only.module, configuration: only.configuration };
  }

  if (withConfig.length > 1) {
    const modulePaths = withConfig.map((x) => x.module.name);
    const wanted = candidates.join(' or ');
    return {
      ok: false,
      error: {
        code: 'MODULE_AMBIGUOUS',
        message:
          `modulePath was omitted and ${modulePaths.length} modules have ${wanted} ` +
          `(${modulePaths.join(', ')}); pass modulePath to disambiguate.` +
          formatAvailableModulesHint(availableModules),
        modulePaths,
      },
    };
  }

  const wanted = candidates.join(' or ');
  const triedName = root?.name ?? 'root';
  return {
    ok: false,
    error: {
      code: 'CONFIGURATION_NOT_FOUND',
      message:
        `Module ${JSON.stringify(triedName)} has none of: ${wanted}.` +
        formatAvailableModulesHint(availableModules),
      moduleName: triedName,
      configuration: candidates[0] ?? 'compileClasspath',
      availableModules,
    },
  };
}
