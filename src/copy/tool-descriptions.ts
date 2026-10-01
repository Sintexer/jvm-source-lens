export type McpToolCopy = {
  title: string;
  description: string;
};

export const MCP_TOOL_COPY = {
  search_classes: {
    title: 'Search classes on the resolved classpath',
    description: `Find which dependency JAR provides a class when you only have a simple name, partial name, or keyword (e.g. ObjectMapper, retry). Use for unknown types in stack traces or imports, instead of unzip/jar searches. Returns FQN + library per hit; next call get_class_structure.`,
  },

  get_class_structure: {
    title: 'Get structured Java class API',
    description: `Show what a third-party library (JAR) class is and does: purpose and method names; scope=declared adds all signatures and fields, scope=effective adds inherited members. First call for any dependency class you can name; use instead of reading source or javap. One method's overloads: get_method_signature.`,
  },

  get_method_signature: {
    title: 'Get Java method overload signatures',
    description: `List every overload (parameters, generics, return type) of one or more methods or constructors ("<init>") of a dependency class. Use to verify a call or pick an overload. Not for bodies: use get_class_source.`,
  },

  find_in_class_source: {
    title: 'Find text in resolved Java source',
    description: `Grep one known dependency class's source for a string, identifier, or pattern (literal; regex optional). Unknown class: search_classes. Whole JAR: search_in_artifact.`,
  },

  get_class_source: {
    title: 'Get Java source for a class',
    description: `Read a dependency class's Java source, ideally only specific methods via methodNames (or startLine/endLine). Use only when you need the implementation, not names or signatures. Sources JAR if present, else decompiled (sourceAvailable=false). Whole files over ~64KiB are refused: pass methodNames.`,
  },

  resolve_dependencies: {
    title: 'Resolve Gradle dependencies',
    description: `List Gradle modules and, with query, the exact dependency versions on the classpath per module (conflicts flagged). Start here for NoSuchMethodError, AbstractMethodError, ClassCastException, or "which version of X is used?"; use instead of reading Gradle files or ~/.gradle caches.`,
  },

  search_in_artifact: {
    title: 'Search text across all classes in one resolved dependency JAR',
    description: `Grep every class in one dependency JAR for a string (log message, exception text, constant). Use when you know the library but not the class. Pass coordinates {group, name, version} (see resolve_dependencies with query) or jarPath.`,
  },
} as const satisfies Record<string, McpToolCopy>;

export type McpToolName = keyof typeof MCP_TOOL_COPY;
