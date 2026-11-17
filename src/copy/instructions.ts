import type { DependencyResolver } from '../resolvers/base.js';
import { allResolvers } from '../resolvers/index.js';

function joinNatural(items: readonly string[], conjunction: 'and' | 'or'): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  if (items.length === 2) {
    return `${items[0]} ${conjunction} ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

export function buildJvmsrcInstructions(
  resolvers: readonly DependencyResolver[] = allResolvers(),
): string {
  const names = resolvers.map((r) => r.displayName);
  const projectLabel = joinNatural(names, 'or');
  const scopeLabel = joinNatural(names, 'and');
  const cacheLabel = names.join('/');
  return `
jvmsrc reads third-party JVM dependencies: classes inside JARs on a ${projectLabel} project's classpath
(structure, signatures, source, versions). ${scopeLabel} projects only.

Use it instead of memory, web search, or javap/unzip/${cacheLabel}-cache digging for any question about
a library class, method, or version — "what does X do", "which JAR has Y", NoSuchMethodError,
ClassCastException, version conflicts. Code under this repo's src/ → grep/read instead.

Flow: search_classes (only if the name is unknown) → get_class_structure → get_class_source with
methodNames. For version problems start with resolve_dependencies.

When you are working inside a specific module, pass modulePath (':app', or the
file you are editing) so you get that module's dependency versions; otherwise omit it to search
all modules. If a call fails, fix the arguments as the error says and retry; never fall back to
javap/unzip.

Declaration lines use short modifiers: P=public p=private prot=protected pack=package-private
s=static f=final a=abstract (e.g. "Psf long ZERO").
`;
}

export const JVMSRC_INSTRUCTIONS = buildJvmsrcInstructions();
