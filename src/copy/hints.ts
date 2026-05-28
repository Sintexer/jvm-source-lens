/** JVM constructor name in signatures and excerpt requests. */
export const CONSTRUCTOR_METHOD_NAME = '<init>';

export const METHOD_NOT_FOUND_ON_CLASS_LINES = [
  `No overloads matched this method name (constructors use ${CONSTRUCTOR_METHOD_NAME}).`,
  'Use get_class_structure scope=overview to browse declared method names.',
] as const;

export const USE_FULL_JSON_HINT = 'Use full=true for structured JSON overload objects.';
