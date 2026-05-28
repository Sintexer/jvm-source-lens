export type McpToolCopy = {
  title: string;
  description: string;
};

export const MCP_TOOL_COPY = {
  search_classes: {
    title: 'Search classes on the resolved classpath',
    description: `Discovery tool for finding classes when you don't know the FQN. Returns a ranked suggestion list: each hit is className (FQN) plus libName (artifact or Gradle module) — enough to call get_class_structure next.

Use this when: the user mentions a type by simple name, you see an unknown class in a stack trace, or you need to locate which dependency provides something. Follow up with get_class_structure (scope=overview) — never jump straight to get_class_source.

Query: case-insensitive substring matched against FQN, simple name, and (when sources are available) declared method/field names and Javadoc text. Globs with * and ? are matched against FQN or simple name only.

Params: query (required); modulePath, configuration, includeTest, limit (default 50, max 200), forceRefresh (after dependency changes). Optional include array expands the response (same tokens in compact text and JSON): simpleName, score, origin, coordinates, location (jarPath/moduleRoot), scope (moduleName/configurationName), indexMeta (index build stats at payload root), all (full per-hit fields plus indexMeta). Default omits jar paths and Maven coordinates.

Returns: compact text — one FQN and libName per line by default; full=true returns JSON with the same default projection unless include expands it. Only set full=true if you are parsing the result programmatically.

Errors: isError=true with RESOLUTION_FAILED if Gradle resolution fails, or a classpath validation code.`,
  },

  get_class_structure: {
    title: 'Get structured Java class API',
    description: `Returns the API surface of a class: purpose, declared methods, optionally fields/annotations/hierarchy. The right starting point after search_classes and before fetching source.

Use this when: you have an FQN and want to know what the class does and what methods it exposes. For a single method's overloads, use get_method_signature instead.

Scope (default = overview):
  • overview   — class purpose + declared method names. Cheapest; start here.
  • declared   — signature lines for all declared members.
  • effective  — declared plus inherited API (capped).

Params: className (required); scope; include (hierarchy/fields/annotations, mainly useful with full=true); standard project params.

Returns: compact text by default; full=true returns JSON. Does not decompile.

Errors: SIGNATURE_EXTRACT_FAILED if javap cannot read the class. CLASS_NOT_FOUND surfaces as isError=false, found=false — a clean miss, not a failure.`,
  },

  get_method_signature: {
    title: 'Get Java method overload signatures',
    description: `Lists every overload of a named method on a class. Preferred over get_class_source whenever you only need signatures.

Use this when: verifying a method exists, checking parameter types, picking the right overload, or confirming a return type. For constructors, pass methodName = "<init>".

Resolution strategy (default, bytecodeOnly=false):
  1. Parse .java from the sources JAR or inter-project src if available — keeps real parameter names and generics (sourceAvailable=true).
  2. Otherwise fall back to javap -private -verbose on bytecode — parameter names may be synthetic like arg0 (sourceAvailable=false).

bytecodeOnly=true forces step 2: javap only on the binary classpath element. Gives full JVM descriptors, flags, and synthetic members; sourceAvailable is always false.

Returns: compact text — one declaration line per overload — by default; full=true returns JSON.

Result semantics:
  • Class missing from classpath: isError=false, found=false (CLASS_NOT_FOUND).
  • Class found but no matching overloads: isError=false, methodFound=false.`,
  },

  find_in_class_source: {
    title: 'Find text in resolved Java source',
    description: `Searches the source of one resolved class for a literal substring or regex. Like grep, but scoped to a single classpath-resolved class — not the workspace.

Use this when: the class is known and you need to locate a specific string, identifier, or pattern inside it. For discovering classes by content, use search_classes instead.

Resolves source the same way as get_class_source (sources JAR preferred; CFR decompilation if absent).

Returns hits with line/column, matched text, optional multiline block, and surrounding context lines. Compact text by default; full=true returns JSON.

Result semantics:
  • Class missing from classpath: isError=false, found=false (CLASS_NOT_FOUND).
  • Class found, pattern not present: isError=false, found=false, querySucceeded=true — a successful scan with no match, not an error.`,
  },

  get_class_source: {
    title: 'Get Java source for a class',
    description: `Returns the Java source of a fully-qualified class. The heaviest tool in the ladder — reach for it only when you genuinely need method bodies.

Use this when: reading implementation details, understanding control flow, or confirming behavior the signature alone can't reveal. Do NOT use it to discover method names (use get_class_structure) or to check signatures (use get_method_signature).

Always prefer an excerpt over full source:
  • methodNames — array of method names to extract. Use "<init>" for constructors. Response echoes matchedMethodNames and unmatchedMethodNames.
  • startLine/endLine — 1-based line range.

If neither excerpt param is given, the full file is returned — keep this as a last resort.

Source provenance: original source from a sources JAR when available (Javadoc, parameter names, generics are ground truth); otherwise CFR decompilation, where structure is reliable but identifiers may be synthetic. Check sourceAvailable on the response.

Returns: compact text source with a provenance footer; full=true returns a JSON envelope. Only set full=true if you are parsing the result.

Result semantics:
  • Class missing from a successfully resolved classpath: isError=false, found=false. Not an access failure.
  • If outputTruncated=true, fetch a narrower excerpt (methodNames or a tighter line range) — do not assume the missing code is absent.

Errors: isError=true with errorCategory, isRetryable, message, and a stable error code.`,
  },

  resolve_dependencies: {
    title: 'Resolve Gradle dependencies',
    description: `Runs (or returns cached) Gradle dependency resolution for the project and reports modules, configurations, and resolved artifacts.

Use this when: diagnosing a version mismatch, debugging NoSuchMethodError / AbstractMethodError / ClassCastException across libraries, or confirming which version of a dependency is actually on the classpath. Start here before chasing symptoms in source.

Params: standard project params; forceRefresh=true bypasses the hash cache — use it after dependency changes that don't touch build files (e.g., SNAPSHOT republish).

Returns: compact text module/configuration summary by default; full=true returns the full artifact JSON. Only set full=true if parsing.

Errors: isError=true with RESOLUTION_FAILED, plus errorCategory, isRetryable, and message.`,
  },
} as const satisfies Record<string, McpToolCopy>;

export type McpToolName = keyof typeof MCP_TOOL_COPY;