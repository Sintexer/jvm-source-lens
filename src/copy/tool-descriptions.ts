export type McpToolCopy = {
  title: string;
  description: string;
};

export const MCP_TOOL_COPY = {
  find_subtypes: {
    title: 'Find subtypes',
    description: 'Find subclasses or implementing classes by owner. For an interface, returns classes only, not subinterfaces.',
  },
  get_package_docs: {
    title: 'Package docs',
    description: 'Package description, types and summaries from source or Javadoc, by owner.',
  },

  search_classes: {
    title: 'Search classes on the resolved classpath',
    description: 'Unknown class or JAR? Search names/keywords from imports or stack traces. Returns FQN + library; next get_class_structure.',
  },

  get_class_structure: {
    title: 'Get structured JVM class API',
    description: `Show what a third-party library (JAR) class is and does: purpose and method names; scope=declared adds all signatures and fields, scope=effective adds inherited members. First call for a dependency class overview; use instead of reading source or javap. One method's overloads: get_method_signature.`,
  },

  get_method_signature: {
    title: 'Get JVM method overload signatures',
    description: 'Verify calls: all overloads with parameters, generics and return types. For bodies use get_class_source.',
  },

  find_in_class_source: {
    title: 'Find text in resolved JVM source',
    description: `Grep one known dependency class's source for a string, identifier, or pattern (literal; regex optional). Unknown class: search_classes. Whole JAR: search_in_artifact.`,
  },

  get_class_source: {
    title: 'Get JVM source for a class',
    description: `Read a dependency class's source (Java, Kotlin, Scala, Groovy), ideally only specific methods via methodNames (or startLine/endLine; Scala/Groovy: startLine/endLine only). Use only when you need the implementation, not names or signatures. Sources JAR if present, else decompiled (sourceAvailable=false). Whole files over ~64KiB are refused: pass methodNames.`,
  },

  resolve_dependencies: {
    title: 'Resolve project dependencies',
    description: 'List modules or query actual classpath versions, counts and conflicts. Start here for version questions, NoSuchMethodError, AbstractMethodError or ClassCastException.',
  },

  search_in_artifact: {
    title: 'Search text across all classes in one resolved dependency JAR',
    description: 'Grep one known JAR, unknown class, for logs, exceptions or constants. Get coordinates from resolve_dependencies.',
  },
} as const satisfies Record<string, McpToolCopy>;

export type McpToolName = keyof typeof MCP_TOOL_COPY;
