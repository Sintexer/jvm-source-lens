/** JVM constructor name in signatures and excerpt requests. */
export const CONSTRUCTOR_METHOD_NAME = '<init>';

export const METHOD_NOT_FOUND_ON_CLASS_LINES = [
  `No overloads matched this method name (found: false; constructors use ${CONSTRUCTOR_METHOD_NAME}).`,
  'If this is a field/constant, use get_class_structure. Otherwise use scope=overview/effective to browse method names.',
] as const;

export const USE_FULL_JSON_HINT = 'Use full=true for structured JSON overload objects.';
