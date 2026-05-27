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
      'Confirm the fully-qualified className, that the dependency is declared in Gradle, and that modulePath matches the owning module (list_modules if unsure).',
    );
  }
  if (!ctx.includeTest && /Test$|Tests$|IT$|Spec$/.test(ctx.className.split('.').pop() ?? '')) {
    parts.push('This looks like a test type — retry with includeTest: true to use testCompileClasspath and src/test/java.');
  } else if (!ctx.includeTest) {
    parts.push('For test-only types, retry with includeTest: true.');
  }
  if (!ctx.modulePath) {
    parts.push('In multimodule builds, pass modulePath (e.g. ":app") to scope the classpath.');
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
  const mode = args.regex ? 'regex' : 'literal substring';
  const lineHint = args.sourceAvailable
    ? ''
    : ' Line numbers are approximate because the compilation unit was decompiled.';
  return (
    `Class ${args.className} was resolved, but ${mode} query ${JSON.stringify(args.query)} matched nothing in that file.${lineHint} ` +
    'Try a shorter literal, disable regex, or search a different spelling. ' +
    'To find which file contains a symbol, use search_classes — find_in_class_source only searches one known className.'
  );
}

export function buildSearchClassesEmptyMessage(ctx: GuidedQueryContext & { query: string }): string {
  const scope = formatClasspathScope(ctx);
  const globHint = ctx.query.includes('*') || ctx.query.includes('?') ? ' Glob ' : ' Substring ';
  return (
    `No classes matched ${JSON.stringify(ctx.query)}${scope}.${globHint}search is case-insensitive on FQN and simple name (glob applies to names only). ` +
    'Broaden the query (e.g. *Repository), set includeTest: true for test sources, or run resolve_dependencies(forceRefresh: true) if the index may be stale. ' +
    'Pick a hit className from search results before calling get_class_source or get_class_structure.'
  );
}

export function buildMethodNotFoundOnClassMessage(className: string, methodName: string): string {
  return (
    `Class ${className} is on the classpath, but no overloads matched method ${JSON.stringify(methodName)}. ` +
    'Constructors use <init>. Call get_class_structure with scope=overview to browse declared method names.'
  );
}
