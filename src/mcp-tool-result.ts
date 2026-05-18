import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ClassSourceError,
  ClassSourceLookupResult,
  DecompiledProvenance,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
import type { SourceExcerptInfo } from './source-excerpt.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';
import { FailureSeverity } from './diagnostics/failure-severity.js';
import type { ResolutionResult } from './resolvers/base.js';
import type { ResolutionOutput } from './resolvers/resolution-output.js';
import type { GetMethodSignatureResult } from './get-method-signatures.js';
import { isSyntheticJvmDescriptor } from './class-structure/parse-java-type-metadata.js';
import type {
  ClassStructureMethod,
  ClassStructureProvenance,
  GetClassStructureResult,
  MethodSignatureProvenance,
} from './class-structure/types.js';
import type { ListModulesPayloadData } from './list-modules-payload.js';
import { buildListModulesPayload } from './list-modules-payload.js';
import type { ClassSearchHit, ClassSearchIndexMeta, SearchClassesResult } from './class-search/types.js';
import type { ClassSourceTextSearchHit } from './class-source-text-search.js';
import type { FindInClassSourceResult } from './find-in-class-source.js';

/** MCP agent recovery categories (transient / validation / business / permission). */
export type McpErrorCategory = 'transient' | 'validation' | 'business' | 'permission';

export type McpClassSourceSuccessPayload = {
  ok: true;
  found: true;
  source: string;
  sourceAvailable: boolean;
  className: string;
  provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
  excerpt?: SourceExcerptInfo;
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
  diagnosticId?: string;
  hint?: string;
};

export type McpClassSourceToolPayload =
  | McpClassSourceSuccessPayload
  | McpClassSourceNotFoundPayload
  | McpClassSourceFailurePayload;

export type McpResolveDependenciesSuccessPayload = {
  ok: true;
  resolution: ResolutionOutput;
};

export type McpResolveDependenciesToolPayload = McpResolveDependenciesSuccessPayload | McpClassSourceFailurePayload;

export type McpListModulesSuccessPayload = { ok: true } & ListModulesPayloadData;

export type McpListModulesToolPayload = McpListModulesSuccessPayload | McpClassSourceFailurePayload;

export type SearchClassesQueryContext = ClassSourceQueryContext & { query: string };

export type FindInClassSourceQueryContext = ClassSourceQueryContext & {
  query: string;
  regex?: boolean;
};

export type McpFindInClassSourceHitPayload = {
  line: number;
  column: number;
  matchedText: string;
  block?: { startLine: number; endLine: number };
  contextBefore: string[];
  contextAfter: string[];
};

export type McpFindInClassSourceSuccessPayload = {
  ok: true;
  found: true;
  querySucceeded: true;
  className: string;
  query: string;
  regex: boolean;
  sourceAvailable: boolean;
  provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
  lineNumbersReliable: boolean;
  totalMatches: number;
  hitCount: number;
  truncated: boolean;
  hits: McpFindInClassSourceHitPayload[];
};

export type McpFindInClassSourceNoMatchPayload = {
  ok: true;
  found: false;
  querySucceeded: true;
  className: string;
  query: string;
  regex: boolean;
  sourceAvailable: boolean;
  provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
  description: string;
};

export type McpFindInClassSourceToolPayload =
  | McpFindInClassSourceSuccessPayload
  | McpFindInClassSourceNoMatchPayload
  | McpClassSourceFailurePayload
  | McpClassSourceNotFoundPayload;

export type McpSearchClassesHitPayload = {
  className: string;
  simpleName: string;
  moduleName: string;
  configurationName: string;
  origin: 'external' | 'interproject' | 'local-file';
  coordinates: { group: string; name: string; version: string | null };
  jarPath: string | null;
  moduleRoot: string | null;
  interprojectModuleName: string | null;
  score: number;
};

export type McpSearchClassesSuccessPayload = {
  ok: true;
  querySucceeded: true;
  query: string;
  limit: number;
  totalMatches: number;
  hitCount: number;
  hits: McpSearchClassesHitPayload[];
  indexMeta: ClassSearchIndexMeta;
};

export type McpSearchClassesToolPayload = McpSearchClassesSuccessPayload | McpClassSourceFailurePayload;

export type ClassSourceQueryContext = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
};

export type McpMethodSignatureSuccessPayload = {
  ok: true;
  found: true;
  querySucceeded: true;
  className: string;
  methodName: string;
  methodFound: boolean;
  sourceAvailable: boolean;
  overloads: Array<{
    declarationLine: string;
    visibility: 'public' | 'protected' | 'package' | 'private';
    /** Omitted on IDE-minimal (source-parse) rows. */
    jvmDescriptor?: string;
    genericSignature?: string | null;
    returnTypeDisplay: string | null;
    parameters: Array<{ name: string | null; typeDisplay: string }>;
    thrownExceptions: string[];
    /** Omitted on IDE-minimal (source-parse) rows. */
    flagsLine?: string | null;
  }>;
  provenance: MethodSignatureProvenance;
};

export type McpMethodSignatureNotFoundPayload = {
  ok: true;
  found: false;
  className: string;
  methodName: string;
  searchedArtifactCount: number;
  querySucceeded: true;
  code: 'CLASS_NOT_FOUND';
  description: string;
};

export type McpMethodSignatureToolPayload =
  | McpMethodSignatureSuccessPayload
  | McpMethodSignatureNotFoundPayload
  | McpClassSourceFailurePayload;

export type McpClassStructureSuccessPayload = {
  ok: true;
  found: true;
  querySucceeded: true;
  className: string;
  kind: 'class' | 'interface' | 'enum' | 'annotation' | 'record';
  superclass: string | null;
  interfaces: string[];
  typeParameters: string[];
  fields: Array<{
    name: string;
    declaringClass: string;
    visibility: 'public' | 'protected' | 'package' | 'private';
    type: string;
    static: boolean;
    final: boolean;
    enumConstant: boolean;
    javadoc: string | null;
    annotations?: Array<{ summary: string }>;
  }>;
  methods: Array<{
    name: string;
    jvmMethodName: string;
    declaringClass: string;
    visibility: 'public' | 'protected' | 'package' | 'private';
    returnType: string;
    parameters: Array<{ name: string | null; type: string }>;
    typeParameters: string[];
    javadoc: string | null;
    abstract: boolean;
    static: boolean;
    throws: string[];
    genericSignature: string | null;
    /** Omitted when the row is declaration-centric (primary type from parsed `.java`, synthetic descriptor stripped). */
    jvmDescriptor?: string | null;
    inherited: boolean;
    annotations?: Array<{ summary: string }>;
  }>;
  sourceAvailable: boolean;
  provenance: ClassStructureProvenance;
  typeHierarchy?: {
    superclassChain: Array<{ className: string; kind: 'class' | 'interface' | 'enum' | 'annotation' | 'record' }>;
    allSuperinterfaces: string[];
  };
  classAnnotations?: Array<{ summary: string }>;
};

export type McpClassStructureNotFoundPayload = {
  ok: true;
  found: false;
  className: string;
  searchedArtifactCount: number;
  querySucceeded: true;
  code: 'CLASS_NOT_FOUND';
  description: string;
};

export type McpClassStructureToolPayload =
  | McpClassStructureSuccessPayload
  | McpClassStructureNotFoundPayload
  | McpClassSourceFailurePayload;

export type MethodSignatureQueryContext = ClassSourceQueryContext & { methodName: string };

function mapFindHit(h: ClassSourceTextSearchHit): McpFindInClassSourceHitPayload {
  return {
    line: h.line,
    column: h.column,
    matchedText: h.matchedText,
    ...(h.block !== undefined ? { block: h.block } : {}),
    contextBefore: h.contextBefore,
    contextAfter: h.contextAfter,
  };
}

export function mcpToolResultFromFindInClassSource(
  result: FindInClassSourceResult,
  query: FindInClassSourceQueryContext,
): CallToolResult {
  if (!result.ok) {
    if (result.error.code === 'CLASS_NOT_FOUND') {
      return mcpNotFoundResult(result.error, query);
    }
    return mcpFailureResult(result.error, query, pickDiag(result));
  }

  if (!result.found) {
    const payload: McpFindInClassSourceNoMatchPayload = {
      ok: true,
      found: false,
      querySucceeded: true,
      className: result.className,
      query: result.query,
      regex: result.regex,
      sourceAvailable: result.sourceAvailable,
      provenance: result.provenance,
      description: result.description,
    };
    const scope = formatQueryScope(query);
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text:
            `find_in_class_source: no matches for ${JSON.stringify(result.query)} in ${result.className}${scope}. ` +
            `The class was resolved successfully.`,
        },
      ],
      structuredContent: payload,
    };
  }

  const hits = result.hits.map(mapFindHit);
  const payload: McpFindInClassSourceSuccessPayload = {
    ok: true,
    found: true,
    querySucceeded: true,
    className: result.className,
    query: result.query,
    regex: result.regex,
    sourceAvailable: result.sourceAvailable,
    provenance: result.provenance,
    lineNumbersReliable: result.lineNumbersReliable,
    totalMatches: result.totalMatches,
    hitCount: result.hitCount,
    truncated: result.truncated,
    hits,
  };
  const scope = formatQueryScope(query);
  const lineHint = result.lineNumbersReliable ? '' : ' (line numbers approximate; decompiled source)';
  const truncHint = result.truncated ? `; showing ${result.hitCount} of ${result.totalMatches}` : '';
  return {
    isError: false,
    content: [
      {
        type: 'text',
        text:
          `find_in_class_source: ${result.totalMatches} match(es) for ${JSON.stringify(result.query)} in ${result.className}${scope}; returning ${result.hitCount}${truncHint}${lineHint}.`,
      },
    ],
    structuredContent: payload,
  };
}

export function mcpToolResultFromClassSource(result: ClassSourceLookupResult, query: ClassSourceQueryContext): CallToolResult {
  if (result.ok) {
    const payload: McpClassSourceSuccessPayload = {
      ok: true,
      found: true,
      source: result.source,
      sourceAvailable: result.sourceAvailable,
      className: result.className,
      provenance: result.provenance,
      ...(result.excerpt !== undefined ? { excerpt: result.excerpt } : {}),
    };
    const excerptHint =
      result.excerpt !== undefined
        ? ` excerpt: ${result.excerpt.matchedMethodNames.length} method(s)` +
          (result.excerpt.unmatchedMethodNames.length > 0
            ? `, ${result.excerpt.unmatchedMethodNames.length} unmatched`
            : '') +
          (result.excerpt.lineNumbersReliable ? '' : '; line numbers approximate (decompiled)')
        : '';
    return mcpSuccessResult(
      result.sourceAvailable
        ? `Retrieved source for ${result.className} (original sources).${excerptHint}`
        : `Retrieved source for ${result.className} (decompiled; sourceAvailable=false).${excerptHint}`,
      payload,
    );
  }

  if (result.error.code === 'CLASS_NOT_FOUND') {
    return mcpNotFoundResult(result.error, query);
  }

  return mcpFailureResult(result.error, query, pickDiag(result));
}

export function mcpToolResultFromProjectRootError(message: string, projectRoot: string): CallToolResult {
  const diag = recordFailureDiagnostic({
    operation: 'mcp_tool',
    publicCode: 'INVALID_PROJECT_ROOT',
    message,
    projectRoot,
    buildSystem: null,
    input: {},
  });
  const error: ClassSourceError = { code: 'RESOLUTION_FAILED', message };
  const envelope = classifyClassSourceError(error, { projectRoot });
  const payload: McpClassSourceFailurePayload = { ...envelope.payload, ...diag };
  return buildMcpErrorCallResult(envelope.summary, payload);
}

function mcpToolResultFromResolutionFailure(
  failed: Extract<ResolutionResult, { ok: false }>,
  projectRoot: string,
): CallToolResult {
  const error: ClassSourceError = {
    code: 'RESOLUTION_FAILED',
    message: failed.message,
    stderr: failed.stderr,
  };
  const envelope = classifyClassSourceError(error, { projectRoot });
  const payload: McpClassSourceFailurePayload = {
    ...envelope.payload,
    ...(failed.diagnosticId !== undefined ? { diagnosticId: failed.diagnosticId, hint: failed.hint } : {}),
  };
  return buildMcpErrorCallResult(envelope.summary, payload);
}

export function mcpToolResultFromResolutionResult(
  result: ResolutionResult,
  projectRoot: string,
): CallToolResult {
  if (result.ok) {
    const { output } = result;
    const payload: McpResolveDependenciesSuccessPayload = { ok: true, resolution: output };
    const partialErrors = output.errors.length;
    const summary =
      `Resolved ${output.modules.length} module(s) at ${output.resolvedAt}` +
      (partialErrors > 0 ? ` with ${partialErrors} partial resolution warning(s) in errors[]` : '') +
      '.';
    return {
      isError: false,
      content: [{ type: 'text', text: summary }],
      structuredContent: payload,
    };
  }

  return mcpToolResultFromResolutionFailure(result, projectRoot);
}

export function mcpToolResultFromListModules(
  result: ResolutionResult,
  projectRoot: string,
): CallToolResult {
  if (result.ok) {
    const data = buildListModulesPayload(result.output);
    const payload: McpListModulesSuccessPayload = { ok: true, ...data };
    const configRows = data.modules.reduce((n, m) => n + m.configurations.length, 0);
    const summary =
      `Listed ${data.modules.length} module(s), ${configRows} classpath configuration row(s)` +
      (data.resolutionWarningCount > 0
        ? ` (${data.resolutionWarningCount} resolution warning(s); use resolve_dependencies for full errors[])`
        : '') +
      '.';
    return {
      isError: false,
      content: [{ type: 'text', text: summary }],
      structuredContent: payload,
    };
  }

  return mcpToolResultFromResolutionFailure(result, projectRoot);
}

export function mcpToolResultFromSearchClasses(
  result: SearchClassesResult,
  query: SearchClassesQueryContext,
): CallToolResult {
  if (result.ok) {
    const hits: McpSearchClassesHitPayload[] = result.hits.map((h: ClassSearchHit) => ({
      className: h.className,
      simpleName: h.simpleName,
      moduleName: h.moduleName,
      configurationName: h.configurationName,
      origin: h.origin,
      coordinates: h.coordinates,
      jarPath: h.jarPath,
      moduleRoot: h.moduleRoot,
      interprojectModuleName: h.interprojectModuleName,
      score: h.score,
    }));
    const payload: McpSearchClassesSuccessPayload = {
      ok: true,
      querySucceeded: true,
      query: result.query,
      limit: result.limit,
      totalMatches: result.totalMatches,
      hitCount: hits.length,
      hits,
      indexMeta: result.indexMeta,
    };
    const scope = formatQueryScope(query);
    const summary =
      `search_classes: ${result.totalMatches} matching class(es) for ${JSON.stringify(result.query)}${scope}; returning ${hits.length} hit(s) (limit ${result.limit}). ` +
      `Index v${result.indexMeta.indexFormatVersion}, ${result.indexMeta.entryCount} entr(ies), sourceEnriched=${result.indexMeta.sourceEnrichedEntries}, skippedArtifacts=${result.indexMeta.skippedArtifacts}.`;
    return {
      isError: false,
      content: [{ type: 'text', text: summary }],
      structuredContent: payload,
    };
  }

  return mcpFailureResult(result.error, query, pickDiag(result));
}

export function mcpToolResultFromUnexpectedError(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error ? e.stack ?? null : null;
  const diag = recordFailureDiagnostic({
    operation: 'mcp_tool',
    publicCode: 'RESOLUTION_FAILED',
    message,
    projectRoot: process.cwd(),
    buildSystem: null,
    input: {},
    stack,
    forceSeverity: FailureSeverity.INTERNAL,
    forceErrorCode: 'UNEXPECTED_EXCEPTION',
  });
  const envelope = classifyUnexpectedError(message);
  const payload: McpClassSourceFailurePayload = { ...envelope.payload, ...diag };
  return buildMcpErrorCallResult(envelope.summary, payload);
}

export function mcpToolResultFromMethodSignature(
  result: GetMethodSignatureResult,
  query: MethodSignatureQueryContext,
): CallToolResult {
  if (result.ok) {
    const overloads =
      result.sourceAvailable === true
        ? result.overloads.map((o) => {
            const row: McpMethodSignatureSuccessPayload['overloads'][number] = {
              declarationLine: o.declarationLine,
              visibility: o.visibility,
              returnTypeDisplay: o.returnTypeDisplay,
              parameters: o.parameters,
              thrownExceptions: o.thrownExceptions,
            };
            if (!isSyntheticJvmDescriptor(o.jvmDescriptor)) {
              row.jvmDescriptor = o.jvmDescriptor;
            }
            if (o.genericSignature != null && o.genericSignature.length > 0) {
              row.genericSignature = o.genericSignature;
            }
            return row;
          })
        : result.overloads;
    const payload: McpMethodSignatureSuccessPayload = {
      ok: true,
      found: true,
      querySucceeded: true,
      className: result.className,
      methodName: result.methodName,
      methodFound: result.methodFound,
      sourceAvailable: result.sourceAvailable,
      overloads,
      provenance: result.provenance,
    };
    const metaHint =
      result.sourceAvailable === true
        ? 'parsed `.java` on classpath'
        : 'javap bytecode metadata';
    const summary = result.methodFound
      ? `Found ${result.overloads.length} overload(s) for ${result.methodName} on ${result.className} (${metaHint}; sourceAvailable=${result.sourceAvailable}).`
      : `Class ${result.className} found on the classpath, but no overloads matched method ${JSON.stringify(result.methodName)} (constructors use <init>).`;
    return {
      isError: false,
      content: [{ type: 'text', text: summary }],
      structuredContent: payload,
    };
  }

  if (result.error.code === 'CLASS_NOT_FOUND') {
    return mcpMethodSignatureNotFoundResult(result.error, query);
  }

  return mcpFailureResult(result.error, query, pickDiag(result));
}

function classStructureMethodsForMcpPayload(
  methods: ClassStructureMethod[],
  sourceAvailable: boolean,
): McpClassStructureSuccessPayload['methods'] {
  return methods.map((m) => {
    if (sourceAvailable && !m.inherited && isSyntheticJvmDescriptor(m.jvmDescriptor)) {
      return {
        ...m,
        jvmDescriptor: null,
        genericSignature: null,
      };
    }
    return { ...m };
  });
}

export function mcpToolResultFromClassStructure(
  result: GetClassStructureResult,
  query: ClassSourceQueryContext,
): CallToolResult {
  if (result.ok) {
    const payload: McpClassStructureSuccessPayload = {
      ok: true,
      found: true,
      querySucceeded: true,
      className: result.className,
      kind: result.kind,
      superclass: result.superclass,
      interfaces: result.interfaces,
      typeParameters: result.typeParameters,
      fields: result.fields,
      methods: classStructureMethodsForMcpPayload(result.methods, result.sourceAvailable),
      sourceAvailable: result.sourceAvailable,
      provenance: result.provenance,
      ...(result.typeHierarchy ? { typeHierarchy: result.typeHierarchy } : {}),
      ...(result.classAnnotations ? { classAnnotations: result.classAnnotations } : {}),
    };
    const inh = result.methods.filter((m: ClassStructureMethod) => m.inherited).length;
    const summary =
      `Structure for ${result.className}: ${result.methods.length} method(s) (${inh} inherited), ${result.fields.length} field(s); ` +
      `sourceAvailable=${result.sourceAvailable}.`;
    return {
      isError: false,
      content: [{ type: 'text', text: summary }],
      structuredContent: payload,
    };
  }

  if (result.error.code === 'CLASS_NOT_FOUND') {
    return mcpClassStructureNotFoundResult(result.error, query);
  }

  return mcpFailureResult(result.error, query, pickDiag(result));
}

function mcpClassStructureNotFoundResult(
  error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>,
  query: ClassSourceQueryContext,
): CallToolResult {
  const scope = formatQueryScope(query);
  const description =
    `The project classpath was resolved successfully${scope}, and ${error.searchedArtifactCount} external JAR(s) were scanned, ` +
    `but no .class entry was found for ${JSON.stringify(error.className)}. ` +
    `This is not a tool or network failure — the class is absent from the selected classpath. ` +
    `Verify the fully-qualified name, ensure the dependency is declared, try a different modulePath or configuration ` +
    `(default compileClasspath; use includeTest for testCompileClasspath), or use forceRefresh after dependency changes. ` +
    `Inter-project module sources are not searched in this version.`;

  const payload: McpClassStructureNotFoundPayload = {
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

function mcpMethodSignatureNotFoundResult(
  error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>,
  query: MethodSignatureQueryContext,
): CallToolResult {
  const scope = formatQueryScope(query);
  const description =
    `The project classpath was resolved successfully${scope}, and ${error.searchedArtifactCount} external JAR(s) were scanned, ` +
    `but no .class entry was found for ${JSON.stringify(error.className)} while looking up ${JSON.stringify(query.methodName)}. ` +
    `This is not a tool or network failure — the class is absent from the selected classpath. ` +
    `Verify the fully-qualified name, ensure the dependency is declared, try a different modulePath or configuration ` +
    `(default compileClasspath; use includeTest for testCompileClasspath), or use forceRefresh after dependency changes. ` +
    `Inter-project module sources are not searched in this version.`;

  const payload: McpMethodSignatureNotFoundPayload = {
    ok: true,
    found: false,
    className: error.className,
    methodName: query.methodName,
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
        text:
          `No class found for ${JSON.stringify(error.className)} after scanning ${error.searchedArtifactCount} artifact(s)${scope} ` +
          `(method query ${JSON.stringify(query.methodName)}). The lookup completed successfully; the class is not on this classpath.`,
      },
    ],
    structuredContent: payload,
  };
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

function pickDiag(r: { diagnosticId?: string; hint?: string }): { diagnosticId: string; hint?: string } | undefined {
  return r.diagnosticId !== undefined ? { diagnosticId: r.diagnosticId, hint: r.hint } : undefined;
}

function mcpFailureResult(
  error: ClassSourceError,
  query: ClassSourceQueryContext,
  diagnostics?: { diagnosticId: string; hint?: string },
): CallToolResult {
  const envelope = classifyClassSourceError(error, query);
  const payload: McpClassSourceFailurePayload = { ...envelope.payload, ...diagnostics };
  return buildMcpErrorCallResult(envelope.summary, payload);
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
          `Run list_modules or inspect resolve_dependencies output for valid names like ":app" or "root". ` +
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

function classifySignatureExtractFailed(
  error: Extract<ClassSourceError, { code: 'SIGNATURE_EXTRACT_FAILED' }>,
): ErrorEnvelope {
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
