import type { ClassSourceError } from './class-source-types.js';
import { matchModule, withoutAllModules } from './match-module.js';
import { resolverById } from '../resolvers/index.js';
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

const AVAILABLE_MODULES_MESSAGE_CAP = 12;

/** Explicit name, else the owning resolver's names for the scope. Empty for an unknown build tool (scope-only match). */
function configurationCandidates(
  explicitName: string | undefined,
  scope: 'compile' | 'test-compile',
  buildSystemType: string,
): readonly string[] {
  if (explicitName !== undefined && explicitName.length > 0) {
    return [explicitName];
  }
  return resolverById(buildSystemType)?.configurationNames?.[scope] ?? [];
}

/** Tail of the CONFIGURATION_NOT_FOUND message, after the module name. */
function missingPhrase(candidates: readonly string[], scope: 'compile' | 'test-compile'): string {
  return candidates.length > 0
    ? `has none of: ${candidates.join(' or ')}.`
    : `has no configuration with scope ${scope}.`;
}

/** Wording for "wanted" in error messages: the candidate names, or the scope when there are none. */
function describeWanted(candidates: readonly string[], scope: 'compile' | 'test-compile'): string {
  return candidates.length > 0 ? candidates.join(' or ') : `a configuration with scope ${scope}`;
}

function pickConfiguration(
  module: ResolvedModule,
  names: readonly string[],
  fallbackScope?: ResolvedConfiguration['scope'],
): ResolvedConfiguration | undefined {
  for (const name of names) {
    const hit = module.configurations.find((c) => c.name === name);
    if (hit !== undefined) {
      return hit;
    }
  }
  if (fallbackScope !== undefined) {
    return module.configurations.find((c) => c.scope === fallbackScope);
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
 * When `modulePath` is omitted: the sole module that has the wanted config is used; if several have
 * it (root included: a root project often has the configuration but an empty classpath, so it must
 * not shadow the submodules), return MODULE_AMBIGUOUS with every candidate so callers that can
 * (search_classes, search_in_artifact) search all of them; if none, CONFIGURATION_NOT_FOUND.
 */
export function pickResolvedConfiguration(
  output: ResolutionOutput,
  rawOpts: PickClasspathOptions,
): PickClasspathResult {
  const opts = withoutAllModules(rawOpts);
  const scope = opts.includeTest ? 'test-compile' : 'compile';
  const candidates = configurationCandidates(opts.configuration, scope, output.buildSystem.type);
  const fallbackScope: ResolvedConfiguration['scope'] | undefined =
    opts.configuration && opts.configuration.length > 0 ? undefined : scope;
  const availableModules = listModuleNames(output);
  const wantModule = opts.modulePath;

  if (wantModule !== undefined && wantModule.length > 0) {
    const match = matchModule(wantModule, output.modules, output.projectRoot);
    if (match.kind !== 'match') {
      const ambiguous = match.kind === 'ambiguous';
      return {
        ok: false,
        error: {
          code: 'MODULE_NOT_FOUND',
          message:
            (ambiguous
              ? `Module ${JSON.stringify(wantModule)} matches several modules (${match.candidates.join(', ')}).`
              : `No resolved module named ${JSON.stringify(wantModule)}.`) +
            formatAvailableModulesHint(ambiguous ? match.candidates : availableModules),
          modulePath: wantModule,
          availableModules: ambiguous ? match.candidates : availableModules,
        },
      };
    }
    const module = match.module;
    const configuration = pickConfiguration(module, candidates, fallbackScope);
    if (configuration === undefined) {
      return {
        ok: false,
        error: {
          code: 'CONFIGURATION_NOT_FOUND',
          message:
            `Module ${JSON.stringify(module.name)} ${missingPhrase(candidates, scope)}` +
            formatAvailableModulesHint(availableModules),
          moduleName: module.name,
          configuration: candidates[0] ?? scope,
          availableModules,
        },
      };
    }
    return { ok: true, module, configuration };
  }

  const root = output.modules.find((m) => m.name === 'root');
  const withConfig: { module: ResolvedModule; configuration: ResolvedConfiguration }[] = [];
  for (const module of output.modules) {
    const configuration = pickConfiguration(module, candidates, fallbackScope);
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
    const wanted = describeWanted(candidates, scope);
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

  const triedName = root?.name ?? 'root';
  return {
    ok: false,
    error: {
      code: 'CONFIGURATION_NOT_FOUND',
      message:
        `Module ${JSON.stringify(triedName)} ${missingPhrase(candidates, scope)}` +
        formatAvailableModulesHint(availableModules),
      moduleName: triedName,
      configuration: candidates[0] ?? scope,
      availableModules,
    },
  };
}
