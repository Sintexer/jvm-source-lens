import type { ClassSourceError } from '../extractor/class-source-types.js';
import type { McpErrorCategory } from '../guided-response/types.js';
import type { ClassifyErrorQueryContext } from './types.js';

export type ClassifiedFailurePayload = {
  ok: false;
  error: ClassSourceError;
  code: ClassSourceError['code'];
  errorCategory: McpErrorCategory;
  isRetryable: boolean;
  message: string;
};

export type ClassifiedFailure = {
  summary: string;
  payload: ClassifiedFailurePayload;
};

export function classifyClassSourceError(
  error: ClassSourceError,
  query: ClassifyErrorQueryContext,
): ClassifiedFailure {
  switch (error.code) {
    case 'INVALID_FQN':
      return envelope(
        error,
        'validation',
        true,
        'Invalid fully-qualified class name.',
        `${error.message} Provide a valid Java FQN (e.g. com.example.MyClass). Inner classes use $ in the simple name. Fix the className argument and retry.`,
      );
    case 'MODULE_NOT_FOUND':
      return envelope(
        error,
        'validation',
        true,
        `Unknown Gradle module ${JSON.stringify(error.modulePath)}.`,
        `No resolved submodule matches modulePath ${JSON.stringify(error.modulePath)}. ` +
          `Inspect resolve_dependencies output (resolution.modules[].name) or settings.gradle for valid names like ":app". ` +
          `Omit modulePath to use the root project union.`,
      );
    case 'CONFIGURATION_NOT_FOUND':
      return envelope(
        error,
        'validation',
        true,
        `Configuration ${JSON.stringify(error.configuration)} not found on ${JSON.stringify(error.moduleName)}.`,
        error.message +
          ` Use a configuration present in resolution output (e.g. compileClasspath, testCompileClasspath) ` +
          `or omit configuration and set includeTest for test scope.`,
      );
    case 'RESOLUTION_FAILED':
      return classifyResolutionFailed(error, query);
    case 'SOURCES_RESOLVE_FAILED':
      return classifySourcesResolveFailed(error);
    case 'ZIP_READ_ERROR':
      return envelope(
        error,
        'transient',
        true,
        `Could not read JAR ${JSON.stringify(error.jarPath)}.`,
        `${error.message} Reading a dependency archive failed (I/O or corrupt ZIP). ` +
          `Retry once; if it persists, check disk permissions, antivirus locks, or re-download the artifact via Gradle.`,
      );
    case 'DECOMPILE_FAILED':
      return classifyDecompileFailed(error);
    case 'SIGNATURE_EXTRACT_FAILED':
      return classifySignatureExtractFailed(error);
    case 'EXCERPT_REQUEST_INVALID':
      return envelope(
        error,
        'validation',
        true,
        'Invalid excerpt parameters.',
        `${error.message} Fix methodNames (use <init> for constructors), or provide both startLine and endLine (1-based, inclusive).`,
      );
    case 'EXCERPT_NOT_FOUND':
      return envelope(
        error,
        'validation',
        true,
        `No excerpt matched in ${JSON.stringify(error.className)}.`,
        `${error.message} Requested: ${error.requestedMethodNames.join(', ')}. ` +
          `Unmatched: ${error.unmatchedMethodNames.join(', ')}. ` +
          `Use get_method_signature to list overload names, or omit excerpt params for the full file.`,
      );
    case 'FIND_QUERY_INVALID':
      return envelope(
        error,
        'validation',
        true,
        'Invalid find-in-source query.',
        `${error.message} Use a non-empty literal substring or a valid regex when regex=true.`,
      );
    case 'FIND_SOURCE_TOO_LARGE':
      return envelope(
        error,
        'validation',
        true,
        'Compilation unit too large for find-in-source.',
        `${error.message} (${error.byteLength} bytes). Narrow with get_class_source excerpt (methodNames) first.`,
      );
    case 'CLASS_NOT_FOUND':
      throw new Error('CLASS_NOT_FOUND must be handled via mcpNotFoundResult (valid empty result, not MCP error)');
  }
}

export function classifyUnexpectedError(message: string): ClassifiedFailure {
  const blob = message;
  const error: ClassSourceError = { code: 'RESOLUTION_FAILED', message };
  if (matchesPermission(blob)) {
    return envelope(
      error,
      'permission',
      false,
      'Operation denied.',
      `An internal error occurred: ${message}. Treat as permission or environment failure.`,
    );
  }
  if (matchesValidation(blob)) {
    return envelope(
      error,
      'validation',
      true,
      'Invalid request or state.',
      `An internal error occurred: ${message}. Fix inputs or installation.`,
    );
  }
  return envelope(
    error,
    'transient',
    true,
    'Unexpected tool failure.',
    `An unexpected error stopped the lookup: ${message}. This may be transient; retry once. If it persists, reinstall jvmsrc or report a bug.`,
  );
}

function classifyResolutionFailed(
  error: Extract<ClassSourceError, { code: 'RESOLUTION_FAILED' }>,
  query: ClassifyErrorQueryContext,
): ClassifiedFailure {
  const blob = joinDiagnosticBlob(error.message, error.stderr);
  if (matchesPermission(blob)) {
    return envelope(
      error,
      'permission',
      false,
      'Gradle resolution denied (authentication or authorization).',
      `Dependency resolution for project ${JSON.stringify(query.projectRoot)} failed because credentials or repository access were denied. ` +
        `${error.message} Do not retry with the same credentials — fix repository auth, VPN, or escalate for access. ` +
        diagnosticSuffix(error.stderr),
    );
  }
  if (matchesValidation(blob) || isProjectPathMessage(error.message)) {
    return envelope(
      error,
      'validation',
      true,
      'Cannot resolve project or classpath.',
      `${error.message} Fix projectRoot (must be an existing Gradle project directory), ensure build.gradle/settings.gradle exist, ` +
        `or install/use ./gradlew. Unsupported or misconfigured projects will fail the same way on every retry until inputs change.` +
        diagnosticSuffix(error.stderr),
    );
  }
  if (matchesTransient(blob)) {
    return envelope(
      error,
      'transient',
      true,
      'Gradle resolution failed temporarily.',
      `${error.message} The build tool could not complete resolution (timeout, network, or daemon issue). ` +
        `The request is valid — retry after a short delay or run with --force-refresh after fixing connectivity.` +
        diagnosticSuffix(error.stderr),
    );
  }
  return envelope(
    error,
    'transient',
    true,
    'Gradle dependency resolution failed.',
    `${error.message} Resolution did not produce a usable classpath. ` +
      `Retry once; if it persists, inspect Gradle output, fix repository or plugin errors, then use forceRefresh.` +
      diagnosticSuffix(error.stderr),
  );
}

function classifySourcesResolveFailed(
  error: Extract<ClassSourceError, { code: 'SOURCES_RESOLVE_FAILED' }>,
): ClassifiedFailure {
  const coords = `${error.coordinates.group}:${error.coordinates.name}:${error.coordinates.version ?? ''}`;
  const blob = joinDiagnosticBlob(error.message, error.stderr);
  if (matchesPermission(blob)) {
    return envelope(
      error,
      'permission',
      false,
      `Sources download denied for ${coords}.`,
      `Gradle could not download the sources artifact for ${coords} due to authentication or authorization. ` +
        `${error.message} Escalate repository access; do not retry blindly.` +
        diagnosticSuffix(error.stderr),
    );
  }
  if (matchesTransient(blob)) {
    return envelope(
      error,
      'transient',
      true,
      `Could not download sources for ${coords}.`,
      `On-demand sources resolution for ${coords} failed (${error.message}). ` +
        `This is usually network or repository availability — retry after a delay. ` +
        `Bytecode decompilation may still be attempted when sources are optional.` +
        diagnosticSuffix(error.stderr),
    );
  }
  return envelope(
    error,
    'business',
    false,
    `Sources artifact unavailable for ${coords}.`,
    `Gradle reported that sources for ${coords} could not be resolved (${error.message}). ` +
      `The main JAR may still be on the classpath; decompilation is used when sources are missing. ` +
      `Do not retry the same coordinates unless repository content changed.` +
      diagnosticSuffix(error.stderr),
  );
}

function classifyDecompileFailed(
  error: Extract<ClassSourceError, { code: 'DECOMPILE_FAILED' }>,
): ClassifiedFailure {
  const blob = joinDiagnosticBlob(error.message, error.stderr);
  if (matchesTransient(blob)) {
    return envelope(
      error,
      'transient',
      true,
      `CFR decompilation timed out for ${error.className}.`,
      `${error.message} Decompilation of ${JSON.stringify(error.className)} from ${JSON.stringify(error.jarPath)} hit a timeout or environment issue. ` +
        `Retry once; ensure JAVA_HOME points to a working JDK.` +
        diagnosticSuffix(error.stderr),
    );
  }
  return envelope(
    error,
    'business',
    false,
    `CFR could not decompile ${error.className}.`,
    `${error.message} Sources JAR was unavailable and bytecode decompilation failed for ${JSON.stringify(error.className)} ` +
      `in ${JSON.stringify(error.jarPath)} (${error.coordinates.group}:${error.coordinates.name}). ` +
      `Retrying the same request will not help unless dependencies or JDK change.` +
      diagnosticSuffix(error.stderr),
  );
}

function classifySignatureExtractFailed(
  error: Extract<ClassSourceError, { code: 'SIGNATURE_EXTRACT_FAILED' }>,
): ClassifiedFailure {
  const blob = joinDiagnosticBlob(error.message, error.stderr);
  const detail =
    error.methodName !== undefined
      ? `${JSON.stringify(error.methodName)} on ${JSON.stringify(error.className)}`
      : JSON.stringify(error.className);
  if (matchesTransient(blob)) {
    return envelope(
      error,
      'transient',
      true,
      `javap failed transiently for ${detail}.`,
      `${error.message} Signature extraction via javap from ${JSON.stringify(error.jarPath)} failed temporarily (timeout, process, or I/O). ` +
        `Retry once; ensure JAVA_HOME points to a JDK that includes javap next to java.` +
        diagnosticSuffix(error.stderr),
    );
  }
  return envelope(
    error,
    'business',
    false,
    `Could not extract bytecode metadata for ${detail}.`,
    `${error.message} javap could not produce bytecode metadata for ${detail} ` +
      `from ${JSON.stringify(error.jarPath)}. Fix JDK availability or verify the class exists in that JAR.` +
      diagnosticSuffix(error.stderr),
  );
}

function envelope(
  error: ClassSourceError,
  errorCategory: McpErrorCategory,
  isRetryable: boolean,
  summary: string,
  message: string,
): ClassifiedFailure {
  const payload: ClassifiedFailurePayload = {
    ok: false,
    error,
    code: error.code,
    errorCategory,
    isRetryable,
    message,
  };
  return { summary, payload };
}

function joinDiagnosticBlob(message: string, stderr?: string): string {
  return stderr ? `${message}\n${stderr}` : message;
}

function diagnosticSuffix(stderr?: string): string {
  return stderr ? ` Gradle stderr: ${stderr.trim().slice(0, 500)}` : '';
}

function isProjectPathMessage(message: string): boolean {
  return /project path does not exist|not a directory/i.test(message);
}

function matchesPermission(blob: string): boolean {
  return /\b(401|403|unauthorized|forbidden|authentication failed|not authorized|access denied|credentials required|permission denied)\b/i.test(
    blob,
  );
}

function matchesValidation(blob: string): boolean {
  return /\b(no supported build system|unsupported|schemaVersion|invalid|malformed|not found in resolution|gradle wrapper)\b/i.test(
    blob,
  );
}

function matchesTransient(blob: string): boolean {
  return /\b(timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|temporarily unavailable|connection reset|network is unreachable|repository unreachable|daemon)\b/i.test(
    blob,
  );
}
