import type { ClassSourceError } from '../extractor/class-source-types.js';
import { FailureSeverity, type FailureSeverity as FailureSeverityT } from './failure-severity.js';

export type PublicFailureCode = ClassSourceError['code'] | 'INVALID_PROJECT_ROOT' | 'CACHE_WRITE_FAILED';

export type MapFailureResult = { severity: FailureSeverityT; errorCode: string };

/**
 * Map stable public `code` + message hints to diagnostic severity and granular `errorCode`.
 */
export function mapPublicFailureToDiagnostic(
  publicCode: PublicFailureCode,
  message: string,
): MapFailureResult {
  const m = message.toLowerCase();

  switch (publicCode) {
    case 'INVALID_FQN':
      return { severity: FailureSeverity.USER_ERROR, errorCode: 'INVALID_FQN' };
    case 'INVALID_PROJECT_ROOT':
      return { severity: FailureSeverity.USER_ERROR, errorCode: 'INVALID_PROJECT_ROOT' };
    case 'MODULE_NOT_FOUND':
      return { severity: FailureSeverity.USER_ERROR, errorCode: 'MODULE_NOT_FOUND' };
    case 'CONFIGURATION_NOT_FOUND':
      return { severity: FailureSeverity.USER_ERROR, errorCode: 'CONFIGURATION_NOT_FOUND' };
    case 'CLASS_NOT_FOUND':
      return { severity: FailureSeverity.EXPECTED, errorCode: 'CLASS_NOT_ON_CLASSPATH' };
    case 'ZIP_READ_ERROR':
      return { severity: FailureSeverity.CACHE_FAIL, errorCode: 'ZIP_READ_ERROR' };
    case 'CACHE_WRITE_FAILED':
      return { severity: FailureSeverity.CACHE_FAIL, errorCode: 'RESOLUTION_CACHE_WRITE_FAILED' };
    case 'RESOLUTION_FAILED':
      if (/not a gradle project|no supported build system|no settings\.gradle|unsupportedprojecterror/i.test(message)) {
        return { severity: FailureSeverity.USER_ERROR, errorCode: 'NOT_GRADLE_PROJECT' };
      }
      if (/could not parse gradle json|invalid resolution\.json|schemaversion|validate.*resolution/i.test(m)) {
        return { severity: FailureSeverity.PARSER_FAIL, errorCode: 'RESOLUTION_OUTPUT_PARSE_FAILED' };
      }
      if (/failed to start gradle/i.test(m)) {
        return { severity: FailureSeverity.ENV_ERROR, errorCode: 'GRADLE_SPAWN_FAILED' };
      }
      if (/\bjava\b.*not found|JAVA_HOME|spawn.*java/i.test(message)) {
        return { severity: FailureSeverity.ENV_ERROR, errorCode: 'JAVA_NOT_FOUND' };
      }
      return { severity: FailureSeverity.RESOLVER_FAIL, errorCode: 'GRADLE_EXIT_NONZERO' };
    case 'SOURCES_RESOLVE_FAILED':
      return { severity: FailureSeverity.RESOLVER_FAIL, errorCode: 'SOURCES_GRADLE_FAILED' };
    case 'DECOMPILE_FAILED':
      if (/timed out/i.test(message)) {
        return { severity: FailureSeverity.DECOMPILE_FAIL, errorCode: 'CFR_TIMEOUT' };
      }
      if (/failed to start java|JAVA_HOME/i.test(message)) {
        return { severity: FailureSeverity.ENV_ERROR, errorCode: 'JAVA_NOT_FOUND' };
      }
      if (/exceeded.*bytes|stdout exceeded/i.test(message)) {
        return { severity: FailureSeverity.DECOMPILE_FAIL, errorCode: 'CFR_OUTPUT_LIMIT' };
      }
      return { severity: FailureSeverity.DECOMPILE_FAIL, errorCode: 'CFR_FAILED' };
    case 'SIGNATURE_EXTRACT_FAILED':
      return { severity: FailureSeverity.PARSER_FAIL, errorCode: 'JAVAP_FAILED' };
    case 'EXCERPT_REQUEST_INVALID':
      return { severity: FailureSeverity.USER_ERROR, errorCode: 'EXCERPT_REQUEST_INVALID' };
    case 'EXCERPT_NOT_FOUND':
      return { severity: FailureSeverity.USER_ERROR, errorCode: 'EXCERPT_NOT_FOUND' };
    default:
      return { severity: FailureSeverity.INTERNAL, errorCode: 'UNKNOWN_FAILURE' };
  }
}
