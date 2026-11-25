import type { DependencyResolver } from '../resolvers/base.js';
import { allResolvers } from '../resolvers/index.js';

function joinNatural(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function buildJvmsrcInstructions(
  resolvers: readonly DependencyResolver[] = allResolvers(),
): string {
  const names = resolvers.map((r) => r.displayName);
  return `
${joinNatural(names)} projects only. Use jvmsrc for dependency classes, methods and versions instead of memory,
web search or cache digging. Package docs cover workspace and dependency packages; for other workspace source, grep/read.

Flow: search_classes (only if the name is unknown) → get_class_structure → get_class_source with
methodNames. For version problems start with resolve_dependencies.

In a module, pass modulePath (':app' or current file); otherwise omit for all modules.
On error follow retry guidance, not javap/unzip.

Declaration lines use short modifiers: P=public p=private prot=protected pack=package-private
s=static f=final a=abstract (e.g. "Psf long ZERO").
`;
}

export const JVMSRC_INSTRUCTIONS = buildJvmsrcInstructions();
