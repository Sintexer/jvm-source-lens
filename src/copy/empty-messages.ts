import { CONSTRUCTOR_METHOD_NAME } from './hints.js';
import type { ClassNotFoundContext, GuidedQueryContext } from './types.js';

export function formatClasspathScope(ctx: GuidedQueryContext): string {
  const parts: string[] = [];
  if (ctx.modulePath) {
    parts.push(`module ${JSON.stringify(ctx.modulePath)}`);
  }
  if (ctx.configuration) {
    parts.push(`configuration ${JSON.stringify(ctx.configuration)}`);
  } else if (ctx.includeTest) {
    parts.push('configuration testCompileClasspath');
  } else {
    parts.push('configuration compileClasspath');
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function looksLikeSimpleName(className: string): boolean {
  return !className.includes('.');
}

/** Heuristic: lowercase-leading camelCase often means a method, not a type. */
export function looksLikeMethodQuery(query: string): boolean {
  const q = query.trim();
  if (q.length === 0 || q.includes('.') || q.includes('*') || q.includes('?')) {
    return false;
  }
  return /^[a-z][a-zA-Z0-9]*$/.test(q);
}

const SUGGESTED_MODULE_PATH_CAP = 10;

export function buildClassNotFoundMessage(ctx: ClassNotFoundContext): string {
  const scope = formatClasspathScope(ctx);
  const methodBit =
    ctx.methodName !== undefined
      ? ` while looking up method ${JSON.stringify(ctx.methodName)}`
      : '';
  const parts = [
    `Classpath resolved successfully${scope}; scanned ${ctx.searchedArtifactCount} classpath edge(s) (JARs, inter-project outputs, local file JARs, and this module's src/main/java` +
      `${ctx.includeTest ? ' and src/test/java' : ''}) but found no .class for ${JSON.stringify(ctx.className)}${methodBit}.`,
    'This is not a transient failure — the type is absent from the selected scope.',
  ];
  if (looksLikeSimpleName(ctx.className)) {
    parts.push(
      `You passed a simple name without a package. Call search_classes(query: ${JSON.stringify(`*${ctx.className}*`)}) to resolve the FQN, then retry with the full className.`,
    );
  } else {
    parts.push(
      'Confirm the fully-qualified className, that the dependency is declared in Gradle, and that modulePath matches the owning module (resolve_dependencies → resolution.modules[].name if unsure).',
    );
  }
  if (ctx.suggestions !== undefined && ctx.suggestions.length > 0) {
    parts.push(
      `Did you mean: ${ctx.suggestions.join(', ')}? Retry with that className.`,
    );
  }
  if (ctx.suggestedModulePaths !== undefined && ctx.suggestedModulePaths.length > 0) {
    const listed = ctx.suggestedModulePaths.slice(0, SUGGESTED_MODULE_PATH_CAP);
    const more =
      ctx.suggestedModulePaths.length > SUGGESTED_MODULE_PATH_CAP
        ? ` (and ${ctx.suggestedModulePaths.length - SUGGESTED_MODULE_PATH_CAP} more)`
        : '';
    parts.push(
      `modulePath was omitted on a multimodule project; the lookup used the default/root scope and did not find this type. ` +
        `Retry with modulePath set to the submodule that depends on this library (often a leaf app/algorithm module), e.g. ${listed.map((m) => JSON.stringify(m)).join(', ')}${more}.`,
    );
  } else if (!ctx.modulePath) {
    parts.push('In multimodule builds, pass modulePath (e.g. ":app") to scope the classpath.');
  }
  if (!ctx.includeTest && /Test$|Tests$|IT$|Spec$/.test(ctx.className.split('.').pop() ?? '')) {
    parts.push('This looks like a test type — retry with includeTest: true to use testCompileClasspath and src/test/java.');
  } else if (!ctx.includeTest) {
    parts.push('For test-only types, retry with includeTest: true.');
  }
  parts.push('After dependency changes, use forceRefresh: true once, then retry.');
  return parts.join(' ');
}

export function buildFindInClassNoMatchMessage(args: {
  className: string;
  query: string;
  regex: boolean;
  sourceAvailable: boolean;
}): string {
  const lineHint = args.sourceAvailable
    ? ''
    : ' Line numbers are approximate because the compilation unit was decompiled.';
  if (args.regex) {
    const pipeHint = args.query.includes('|')
      ? ' If you meant a literal pipe or alternation was accidental, retry with regex: false (default is literal substring).'
      : '';
    return (
      `Class ${args.className} was resolved, but regex query ${JSON.stringify(args.query)} matched nothing in that file.${lineHint} ` +
      `regex: true was set — the pattern is interpreted as a JavaScript RegExp, not a literal.${pipeHint} ` +
      'Try a shorter literal with regex omitted/false, escape special characters, or search a different spelling. ' +
      'To find which file contains a symbol, use search_classes — find_in_class_source only searches one known className.'
    );
  }
  return (
    `Class ${args.className} was resolved, but literal substring query ${JSON.stringify(args.query)} matched nothing in that file.${lineHint} ` +
    'Try a shorter literal or a different spelling. Only set regex: true when you intend a RegExp. ' +
    'To find which file contains a symbol, use search_classes — find_in_class_source only searches one known className.'
  );
}

export function buildSearchClassesEmptyMessage(ctx: GuidedQueryContext & { query: string }): string {
  const scope = formatClasspathScope(ctx);
  const globHint = ctx.query.includes('*') || ctx.query.includes('?') ? ' Glob ' : ' Substring ';
  const parts = [
    `No classes matched ${JSON.stringify(ctx.query)}${scope}.${globHint}search is case-insensitive on FQN and simple name (glob applies to names only). ` +
      'Declared method/field names are searchable only when the class-search index could enrich from sources.',
  ];
  if (looksLikeMethodQuery(ctx.query)) {
    parts.push(
      `Query ${JSON.stringify(ctx.query)} looks like a method name. search_classes is type-oriented; for text inside a known dependency JAR use search_in_artifact (coordinates or jarPath). ` +
        'Once you know the owning class, use get_class_structure then get_method_signature / get_class_source.',
    );
  } else {
    parts.push(
      'Broaden the query (e.g. *Repository), set includeTest: true for test sources, or run resolve_dependencies(forceRefresh: true) if the index may be stale. ' +
        'Pick a hit className from search results before calling get_class_source or get_class_structure.',
    );
  }
  return parts.join(' ');
}

export function buildMethodNotFoundOnClassMessage(className: string, methodName: string): string {
  return (
    `Class ${className} is on the classpath, but no overloads matched method ${JSON.stringify(methodName)}. ` +
    `Constructors use ${CONSTRUCTOR_METHOD_NAME}. Call get_class_structure with scope=effective to see inherited methods and their declaringClass, ` +
    `then call get_method_signature or get_class_source on that declaring type (method bodies often live on a superclass, not the subclass).`
  );
}
