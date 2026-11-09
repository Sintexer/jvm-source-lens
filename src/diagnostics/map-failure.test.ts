import { expect, test } from 'bun:test';
import { mapPublicFailureToDiagnostic } from './map-failure.js';
import { FailureSeverity } from './failure-severity.js';

test('RESOLUTION_FAILED parse error maps to parser_fail', () => {
  const m = mapPublicFailureToDiagnostic(
    'RESOLUTION_FAILED',
    'Could not parse Gradle JSON output: unexpected token',
  );
  expect(m.severity).toBe(FailureSeverity.PARSER_FAIL);
  expect(m.errorCode).toBe('RESOLUTION_OUTPUT_PARSE_FAILED');
});

test('CLASS_NOT_FOUND is expected', () => {
  const m = mapPublicFailureToDiagnostic('CLASS_NOT_FOUND', 'not found');
  expect(m.severity).toBe(FailureSeverity.EXPECTED);
});

test('shouldMapSourceOutputTooLargeToUserErrorWhenAgentRequestsFullSource', () => {
  const m = mapPublicFailureToDiagnostic('SOURCE_OUTPUT_TOO_LARGE', 'Refusing unscoped full source');
  expect(m.severity).toBe(FailureSeverity.USER_ERROR);
  expect(m.errorCode).toBe('SOURCE_OUTPUT_TOO_LARGE');
});

test.each([
  ['gradle/wrapper/gradle-wrapper.jar is a Git LFS pointer, not a real JAR.', '', 'WRAPPER_BROKEN'],
  ['Gradle exited with code 1', 'Error: Could not find or load main class org.gradle.wrapper.GradleWrapperMain', 'WRAPPER_BROKEN'],
  ['Gradle exited with code 1', 'ERROR: Credentials to access nexus.example.com repo are NOT defined!', 'BUILD_CREDENTIALS_MISSING'],
  ['Gradle exited with code 1', "Task 'jvmsrcResolve' not found in project ':app'.", 'INIT_SCRIPT_TASK_MISSING'],
  ['Gradle exited with code 1', 'Dependency requires at least JVM runtime version 25. This build uses a Java 17 JVM.', 'JVM_VERSION_MISMATCH'],
])('shouldClassifyGradleFailureByStderrWhen %#', (message, stderr, code) => {
  const m = mapPublicFailureToDiagnostic('RESOLUTION_FAILED', message, stderr);
  expect(m.errorCode).toBe(code);
  expect(m.severity).toBe(FailureSeverity.ENV_ERROR);
});

test('shouldKeepGradleExitNonzeroWhenStderrUnrecognized', () => {
  const m = mapPublicFailureToDiagnostic('RESOLUTION_FAILED', 'Gradle exited with code 1', 'boom');
  expect(m.errorCode).toBe('GRADLE_EXIT_NONZERO');
});
