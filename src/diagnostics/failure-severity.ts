export const FailureSeverity = {
  USER_ERROR: 'user_error',
  EXPECTED: 'expected',
  ENV_ERROR: 'env_error',
  RESOLVER_FAIL: 'resolver_fail',
  PARSER_FAIL: 'parser_fail',
  DECOMPILE_FAIL: 'decompile_fail',
  CACHE_FAIL: 'cache_fail',
  INTERNAL: 'internal',
} as const;

export type FailureSeverity = (typeof FailureSeverity)[keyof typeof FailureSeverity];

export const DIAGNOSTIC_FILE_SEVERITIES: ReadonlySet<FailureSeverity> = new Set([
  FailureSeverity.RESOLVER_FAIL,
  FailureSeverity.PARSER_FAIL,
  FailureSeverity.DECOMPILE_FAIL,
  FailureSeverity.INTERNAL,
]);
