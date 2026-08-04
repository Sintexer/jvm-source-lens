import { ensureClassSearchIndex } from './class-search/ensure-class-search-index.js';
import { suggestClassNamesBySimpleName } from './class-search/suggest-class-names.js';
import { listModuleNames } from './extractor/infer-module-path.js';
import { pickResolvedConfiguration } from './extractor/pick-classpath.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import type { ResolutionOutput } from './resolvers/resolution-output.js';

export type EnrichClassNotFoundScope = {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
};

type ClassNotFoundError = Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>;

const MAX_SUGGESTIONS = 5;

/**
 * Best-effort `CLASS_NOT_FOUND` enrichment: adds `suggestedModulePaths` (when `modulePath` was
 * omitted on a multimodule project) and `suggestions` (did-you-mean FQNs sharing the missed
 * simple name, from the class-search index). Never throws — any failure just omits the field.
 */
/** Passthrough for non-`CLASS_NOT_FOUND` codes; convenience for call sites with a generic `ClassSourceError`. */
export function enrichIfClassNotFound(
  projectRoot: string,
  output: ResolutionOutput,
  error: ClassSourceError,
  scope: EnrichClassNotFoundScope,
): ClassSourceError {
  if (error.code !== 'CLASS_NOT_FOUND') {
    return error;
  }
  return enrichClassNotFound(projectRoot, output, error, scope);
}

export function enrichClassNotFound(
  projectRoot: string,
  output: ResolutionOutput,
  error: ClassNotFoundError,
  scope: EnrichClassNotFoundScope,
): ClassNotFoundError {
  const suggestedModulePaths = computeSuggestedModulePaths(output, scope);
  const suggestions = computeSuggestions(projectRoot, output, error.className, scope);

  return {
    ...error,
    ...(suggestedModulePaths !== undefined ? { suggestedModulePaths } : {}),
    ...(suggestions !== undefined && suggestions.length > 0 ? { suggestions } : {}),
  };
}

function computeSuggestedModulePaths(
  output: ResolutionOutput,
  scope: EnrichClassNotFoundScope,
): string[] | undefined {
  const hasExplicitModulePath = scope.modulePath !== undefined && scope.modulePath.length > 0;
  if (hasExplicitModulePath || output.modules.length <= 1) {
    return undefined;
  }
  return listModuleNames(output);
}

function computeSuggestions(
  projectRoot: string,
  output: ResolutionOutput,
  className: string,
  scope: EnrichClassNotFoundScope,
): string[] | undefined {
  try {
    const modulesToTry =
      scope.modulePath !== undefined && scope.modulePath.length > 0
        ? [scope.modulePath]
        : listModuleNames(output);

    const seen = new Set<string>();
    const combined: string[] = [];

    for (const modulePath of modulesToTry) {
      if (combined.length >= MAX_SUGGESTIONS) {
        break;
      }
      const picked = pickResolvedConfiguration(output, {
        modulePath,
        configuration: scope.configuration,
        includeTest: scope.includeTest,
      });
      if (!picked.ok) {
        continue;
      }
      const ensured = ensureClassSearchIndex(projectRoot, output, {
        module: picked.module,
        configuration: picked.configuration,
        includeTest: Boolean(scope.includeTest),
      });
      if (!ensured.ok) {
        continue;
      }
      for (const name of suggestClassNamesBySimpleName(ensured.file.entries, className, MAX_SUGGESTIONS)) {
        if (!seen.has(name)) {
          seen.add(name);
          combined.push(name);
        }
      }
    }

    return combined.slice(0, MAX_SUGGESTIONS);
  } catch {
    return undefined;
  }
}
