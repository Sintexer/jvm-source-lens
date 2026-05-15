import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import type { DecompiledProvenance, SourcesJarProvenance } from './extractor/class-source-types.js';

/** MCP agent recovery categories (transient / validation / business / permission). */
export type McpErrorCategory = 'transient' | 'validation' | 'business' | 'permission';

export type McpClassSourceSuccessPayload = {
  ok: true;
  found: true;
  source: string;
  sourceAvailable: boolean;
  className: string;
  provenance: SourcesJarProvenance | DecompiledProvenance;
};

/** Classpath was resolved and scanned; the class is not on it (not an access failure). */
export type McpClassSourceNotFoundPayload = {
  ok: true;
  found: false;
  className: string;
  searchedArtifactCount: number;
  querySucceeded: true;
  code: 'CLASS_NOT_FOUND';
  description: string;
};

export type McpClassSourceFailurePayload = {
  ok: false;
  error: ClassSourceError;
  code: ClassSourceError['code'];
  errorCategory: McpErrorCategory;
  isRetryable: boolean;
  description: string;
};

export type McpClassSourceToolPayload =
  | McpClassSourceSuccessPayload
  | McpClassSourceNotFoundPayload
  | McpClassSourceFailurePayload;

export type ClassSourceQueryContext = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
};

export function mcpToolResultFromClassSource(
  result: { ok: true; source: string; sourceAvailable: boolean; className: string; provenance: SourcesJarProvenance | DecompiledProvenance } | { ok: false; error: ClassSourceError },
  query: ClassSourceQueryContext,
): CallToolResult {
  if (result.ok) {
    const payload: McpClassSourceSuccessPayload = {
      ok: true,
      found: true,
      source: result.source,
      sourceAvailable: result.sourceAvailable,
      className: result.className,
      provenance: result.provenance,
    };
    return mcpSuccessResult(
      result.sourceAvailable
        ? `Retrieved source for ${result.className} (original sources).`
        : `Retrieved source for ${result.className} (decompiled; sourceAvailable=false).`,
      payload,
    );
  }

  if (result.error.code === 'CLASS_NOT_FOUND') {
    return mcpNotFoundResult(result.error, query);
  }

  return mcpFailureResult(result.error, query);
}

export function mcpToolResultFromProjectRootError(message: string, projectRoot: string): CallToolResult {
  const error: ClassSourceError = { code: 'RESOLUTION_FAILED', message };
  const envelope = classifyClassSourceError(error, { projectRoot });
  return buildMcpErrorCallResult(envelope.summary, envelope.payload);
}

export function mcpToolResultFromUnexpectedError(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  const envelope = classifyUnexpectedError(message);
  return buildMcpErrorCallResult(envelope.summary, envelope.payload);
}

function mcpNotFoundResult(error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>, query: ClassSourceQueryContext): CallToolResult {
  const scope = formatQueryScope(query);
  const description =
    `The project classpath was resolved successfully${scope}, and ${error.searchedArtifactCount} external JAR(s) were scanned, ` +
    `but no .class entry was found for ${JSON.stringify(error.className)}. ` +
    `This is not a tool or network failure — the class is absent from the selected classpath. ` +
    `Verify the fully-qualified name, ensure the dependency is declared, try a different modulePath or configuration ` +
    `(default compileClasspath; use includeTest for testCompileClasspath), or use forceRefresh after dependency changes. ` +
    `Inter-project module sources are not searched in this version.`;

  const payload: McpClassSourceNotFoundPayload = {
    ok: true,
    found: false,
    className: error.className,
    searchedArtifactCount: error.searchedArtifactCount,
    querySucceeded: true,
    code: 'CLASS_NOT_FOUND',
    description,
  };

  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: `No class found for ${JSON.stringify(error.className)} after scanning ${error.searchedArtifactCount} artifact(s)${scope}. The lookup completed successfully; the class is not on this classpath.`,
      },
    ],
    structuredContent: payload,
  };
}

function mcpFailureResult(error: ClassSourceError, query: ClassSourceQueryContext): CallToolResult {
  const envelope = classifyClassSourceError(error, query);
  return buildMcpErrorCallResult(envelope.summary, envelope.payload);
}

function mcpSuccessResult(summary: string, payload: McpClassSourceSuccessPayload): CallToolResult {
  return {
    isError: false,
    content: [{ type: 'text', text: summary }],
    structuredContent: payload,
  };
}

function buildMcpErrorCallResult(summary: string, payload: McpClassSourceFailurePayload): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: summary }],
    structuredContent: payload,
    errorCategory: payload.errorCategory,
    isRetryable: payload.isRetryable,
    description: payload.description,
  } as CallToolResult;
}

type ErrorEnvelope = { summary: string; payload: McpClassSourceFailurePayload };

function classifyClassSourceError(error: ClassSourceError, query: ClassSourceQueryContext): ErrorEnvelope {
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
          `Run list_modules (when available) or inspect resolution output for valid names like ":app" or "root". ` +
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
    case 'CLASS_NOT_FOUND':
      throw new Error('CLASS_NOT_FOUND must be handled via mcpNotFoundResult (valid empty result, not MCP error)');
  }
}

function classifyResolutionFailed(
  error: Extract<ClassSourceError, { code: 'RESOLUTION_FAILED' }>,
  query: ClassSourceQueryContext,
): ErrorEnvelope {
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
): ErrorEnvelope {
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
): ErrorEnvelope {
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

function classifyUnexpectedError(message: string): ErrorEnvelope {
  const blob = message;
  const error: ClassSourceError = { code: 'RESOLUTION_FAILED', message };
  if (matchesPermission(blob)) {
    return envelope(error, 'permission', false, 'Operation denied.', `An internal error occurred: ${message}. Treat as permission or environment failure.`);
  }
  if (matchesValidation(blob)) {
    return envelope(error, 'validation', true, 'Invalid request or state.', `An internal error occurred: ${message}. Fix inputs or installation.`);
  }
  return envelope(
    error,
    'transient',
    true,
    'Unexpected tool failure.',
    `An unexpected error stopped the lookup: ${message}. This may be transient; retry once. If it persists, reinstall jvmsrc or report a bug.`,
  );
}

function envelope(
  error: ClassSourceError,
  errorCategory: McpErrorCategory,
  isRetryable: boolean,
  summary: string,
  description: string,
): ErrorEnvelope {
  const payload: McpClassSourceFailurePayload = {
    ok: false,
    error,
    code: error.code,
    errorCategory,
    isRetryable,
    description,
  };
  return { summary, payload };
}

function formatQueryScope(query: ClassSourceQueryContext): string {
  const parts: string[] = [];
  if (query.modulePath) {
    parts.push(`module ${JSON.stringify(query.modulePath)}`);
  }
  if (query.configuration) {
    parts.push(`configuration ${JSON.stringify(query.configuration)}`);
  } else if (query.includeTest) {
    parts.push('configuration testCompileClasspath');
  } else {
    parts.push('configuration compileClasspath');
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
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
