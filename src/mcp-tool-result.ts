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
import type {
  ClassSearchIncludeSection,
  ProjectedSearchClassesHit,
} from './class-search/project-search-hit.js';
import {
  projectSearchClassesHit,
  projectSearchClassesIndexMeta,
} from './class-search/project-search-hit.js';
import type { ClassSearchIndexMeta, SearchClassesResult } from './class-search/types.js';
import type { ClassSourceTextSearchHit } from './class-source-text-search.js';
import type { FindInClassSourceResult } from './find-in-class-source.js';
import { projectClassStructure, type ClassStructureIncludeSection } from './mcp-projection/class-structure.js';
import { projectResolution, type ResolutionIncludeSection } from './mcp-projection/resolution.js';
import { projectFindHit, type FindInClassIncludeSection } from './mcp-projection/find-in-class.js';
import { projectOverload, type MethodSignatureIncludeSection } from './mcp-projection/method-signature.js';
import { projectProvenance } from './mcp-projection/provenance.js';
import { resolveResponseDetailWithEnv, type ResponseDetail } from './response-detail.js';
import {
  formatClassStructureSummaryLine,
  formatClassStructureText,
} from './text-format/format-class-structure.js';
import { formatClassSourceCompactText } from './text-format/format-class-source.js';
import {
  formatFindInClassNoMatchText,
  formatFindInClassSourceText,
} from './text-format/format-find-in-class.js';
import { formatMethodSignatureText } from './text-format/format-method-signature.js';
import { formatResolutionSummaryText } from './text-format/format-resolve.js';
import { formatListModulesText } from './text-format/format-list-modules.js';
import { formatSearchClassesText } from './text-format/format-search.js';
import type { ClassStructureScope as ClassStructureScopeType } from './class-structure/types.js';
import {
  appendGuidanceFooter,
  guidedEnvelope,
  outcomeOnlySuccessFields,
  withGuidedEnvelope,
} from './guided-response/envelope.js';
import {
  buildClassNotFoundMessage,
  buildMethodNotFoundOnClassMessage,
  buildSearchClassesEmptyMessage,
  classifyClassSourceError,
  classifyUnexpectedError,
  formatClasspathScope,
} from './copy/index.js';
import type { GuidedEnvelopeFields, McpErrorCategory } from './guided-response/types.js';

export type { McpErrorCategory };
export type { ClassStructureIncludeSection, ResolutionIncludeSection, FindInClassIncludeSection, MethodSignatureIncludeSection };

export type McpClassSourceSuccessPayload = {
  ok: true;
  found: true;
  source: string;
  sourceAvailable: boolean;
  className: string;
  provenance: SourcesJarProvenance | DecompiledProvenance | InterprojectProvenance;
  excerpt?: SourceExcerptInfo;
  outputTruncated?: boolean;
  sourceLength?: number;
};

/** Classpath was resolved and scanned; the class is not on it (not an access failure). */
export type McpClassSourceNotFoundPayload = {
  ok: true;
  found: false;
  className: string;
  searchedArtifactCount: number;
  querySucceeded: true;
  code: 'CLASS_NOT_FOUND';
  message: string;
};

export type McpClassSourceFailurePayload = {
  ok: false;
  error: ClassSourceError;
  code: ClassSourceError['code'];
  errorCategory: McpErrorCategory;
  isRetryable: boolean;
  message: string;
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

export type SearchClassesQueryContext = ClassSourceQueryContext & {
  query: string;
  include?: ClassSearchIncludeSection[];
};

export type FindInClassSourceQueryContext = ClassSourceQueryContext & {
  query: string;
  regex?: boolean;
  /** Response projection. Default: line/column/matchedText only. */
  include?: FindInClassIncludeSection[];
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
  message: string;
};

export type McpFindInClassSourceToolPayload =
  | McpFindInClassSourceSuccessPayload
  | McpFindInClassSourceNoMatchPayload
  | McpClassSourceFailurePayload
  | McpClassSourceNotFoundPayload;

export type McpSearchClassesHitPayload = ProjectedSearchClassesHit;

export type McpSearchClassesSuccessPayload = {
  ok: true;
  found: boolean;
  querySucceeded: true;
  query: string;
  limit: number;
  totalMatches: number;
  hitCount: number;
  hits: McpSearchClassesHitPayload[];
  indexMeta?: ClassSearchIndexMeta;
};

export type McpSearchClassesToolPayload = McpSearchClassesSuccessPayload | McpClassSourceFailurePayload;

export type ClassSourceQueryContext = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  /** When true, return structured JSON (`structuredContent`). Default compact plain text. */
  full?: boolean;
};

export type ClassStructureQueryContext = ClassSourceQueryContext & {
  scope?: ClassStructureScopeType;
  /** Response projection for JSON (full=true). */
  include?: ClassStructureIncludeSection[];
};

function toolResponseDetail(full?: boolean): ResponseDetail {
  return resolveResponseDetailWithEnv(full);
}

function mcpCompactSuccess(text: string): CallToolResult {
  return {
    isError: false,
    content: [{ type: 'text', text }],
  };
}

function mcpFullSuccess(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

function returnCompactPlain(text: string): CallToolResult {
  return mcpCompactSuccess(text);
}

function returnFullPlain(summary: string, payload: Record<string, unknown>, found = true): CallToolResult {
  return mcpFullSuccess(summary, withGuidedEnvelope(payload, outcomeOnlySuccessFields(found)));
}

function returnCompactGuided(text: string, env: GuidedEnvelopeFields): CallToolResult {
  return mcpCompactSuccess(appendGuidanceFooter(text, env));
}

function returnFullGuided(summary: string, payload: Record<string, unknown>, env: GuidedEnvelopeFields): CallToolResult {
  return mcpFullSuccess(summary, withGuidedEnvelope(payload, env));
}

function classNotFoundEnvelope(
  error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>,
  query: ClassSourceQueryContext & { methodName?: string },
): GuidedEnvelopeFields {
  const message = buildClassNotFoundMessage({
    className: error.className,
    searchedArtifactCount: error.searchedArtifactCount,
    modulePath: query.modulePath,
    configuration: query.configuration,
    includeTest: query.includeTest,
    methodName: query.methodName,
  });
  return guidedEnvelope(message, false);
}

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
  message: string;
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
  message: string;
};

export type McpClassStructureToolPayload =
  | McpClassStructureSuccessPayload
  | McpClassStructureNotFoundPayload
  | McpClassSourceFailurePayload;

export type MethodSignatureQueryContext = ClassSourceQueryContext & {
  methodName: string;
  /** Response projection for JSON (full=true). */
  include?: MethodSignatureIncludeSection[];
};

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
  const detail = toolResponseDetail(query.full);
  if (!result.ok) {
    if (result.error.code === 'CLASS_NOT_FOUND') {
      return mcpNotFoundResult(result.error, query);
    }
    return mcpFailureResult(result.error, query, pickDiag(result));
  }

  if (!result.found) {
    const env = guidedEnvelope(result.message, false);
    if (detail === 'compact') {
      return returnCompactGuided(formatFindInClassNoMatchText(result), env);
    }
    const payload: McpFindInClassSourceNoMatchPayload = {
      ok: true,
      found: false,
      querySucceeded: true,
      className: result.className,
      query: result.query,
      regex: result.regex,
      sourceAvailable: result.sourceAvailable,
      provenance: result.provenance,
      message: result.message,
    };
    return returnFullGuided(
      `find_in_class_source: no matches for ${JSON.stringify(result.query)} in ${result.className}${formatClasspathScope(query)}.`,
      payload,
      env,
    );
  }

  if (detail === 'compact') {
    return returnCompactPlain(formatFindInClassSourceText(result));
  }

  const hits = result.hits.map((h) => projectFindHit(h, query.include));
  const wantsFullProv = query.include?.includes('all') || query.include?.includes('provenance');
  const payload: Record<string, unknown> = {
    ok: true,
    found: true,
    querySucceeded: true,
    className: result.className,
    query: result.query,
    regex: result.regex,
    sourceAvailable: result.sourceAvailable,
    provenance: wantsFullProv ? result.provenance : projectProvenance(result.provenance, query.include as string[] | undefined),
    lineNumbersReliable: result.lineNumbersReliable,
    totalMatches: result.totalMatches,
    hitCount: result.hitCount,
    truncated: result.truncated,
    hits,
  };
  const scope = formatClasspathScope(query);
  return returnFullPlain(
    `find_in_class_source: ${result.totalMatches} match(es) for ${JSON.stringify(result.query)} in ${result.className}${scope}.`,
    payload,
  );
}

export function mcpToolResultFromClassSource(result: ClassSourceLookupResult, query: ClassSourceQueryContext): CallToolResult {
  const detail = toolResponseDetail(query.full);
  if (result.ok) {
    if (detail === 'compact') {
      return returnCompactPlain(formatClassSourceCompactText(result));
    }
    const payload: McpClassSourceSuccessPayload = {
      ok: true,
      found: true,
      source: result.source,
      sourceAvailable: result.sourceAvailable,
      className: result.className,
      provenance: result.provenance,
      ...(result.excerpt !== undefined ? { excerpt: result.excerpt } : {}),
      ...(result.outputTruncated ? { outputTruncated: true, sourceLength: result.sourceLength } : {}),
    };
    return returnFullPlain(`Retrieved source for ${result.className}.`, payload);
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
  full?: boolean,
  include?: ResolutionIncludeSection[],
): CallToolResult {
  const detail = toolResponseDetail(full);
  if (result.ok) {
    const { output } = result;
    if (detail === 'compact') {
      return returnCompactPlain(formatResolutionSummaryText(output));
    }
    const projected = projectResolution(output, include);
    return returnFullPlain(`Resolved ${output.modules.length} module(s).`, projected as Record<string, unknown>);
  }

  return mcpToolResultFromResolutionFailure(result, projectRoot);
}

export function mcpToolResultFromListModules(
  result: ResolutionResult,
  projectRoot: string,
  full?: boolean,
): CallToolResult {
  const detail = toolResponseDetail(full);
  if (result.ok) {
    const data = buildListModulesPayload(result.output);
    if (detail === 'compact') {
      return returnCompactPlain(formatListModulesText(data));
    }
    const payload: McpListModulesSuccessPayload = { ok: true, ...data };
    return returnFullPlain(`Listed ${data.modules.length} module(s).`, payload);
  }

  return mcpToolResultFromResolutionFailure(result, projectRoot);
}

export function mcpToolResultFromSearchClasses(
  result: SearchClassesResult,
  query: SearchClassesQueryContext,
): CallToolResult {
  const detail = toolResponseDetail(query.full);
  if (result.ok) {
    const found = result.totalMatches > 0;
    if (detail === 'compact') {
      const text = formatSearchClassesText({
        query: result.query,
        totalMatches: result.totalMatches,
        hits: result.hits,
        limit: result.limit,
        include: query.include,
      });
      if (!found) {
        return returnCompactGuided(
          text,
          guidedEnvelope(buildSearchClassesEmptyMessage({ ...query, query: result.query }), false),
        );
      }
      return returnCompactPlain(text);
    }
    const hits: McpSearchClassesHitPayload[] = result.hits.map((h) =>
      projectSearchClassesHit(h, query.include),
    );
    const indexMeta = projectSearchClassesIndexMeta(result.indexMeta, query.include);
    const payload: McpSearchClassesSuccessPayload = {
      ok: true,
      found,
      querySucceeded: true,
      query: result.query,
      limit: result.limit,
      totalMatches: result.totalMatches,
      hitCount: hits.length,
      hits,
      ...(indexMeta !== undefined ? { indexMeta } : {}),
    };
    const scope = formatClasspathScope(query);
    if (!found) {
      return returnFullGuided(
        `search_classes: 0 matches for ${JSON.stringify(result.query)}${scope}.`,
        payload,
        guidedEnvelope(buildSearchClassesEmptyMessage({ ...query, query: result.query }), false),
      );
    }
    return returnFullPlain(
      `search_classes: ${result.totalMatches} match(es) for ${JSON.stringify(result.query)}${scope}.`,
      payload,
    );
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
  const detail = toolResponseDetail(query.full);
  if (result.ok) {
    if (!result.methodFound) {
      const env = guidedEnvelope(
        buildMethodNotFoundOnClassMessage(result.className, result.methodName),
        true,
      );
      if (detail === 'compact') {
        return returnCompactGuided(formatMethodSignatureText(result), env);
      }
    } else if (detail === 'compact') {
      return returnCompactPlain(formatMethodSignatureText(result));
    }
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
    const projectedOverloads = overloads.map((o) => projectOverload(o, query.include));
    const wantsFullProv = query.include?.includes('all') || query.include?.includes('provenance');
    const payload: Record<string, unknown> = {
      ok: true,
      found: true,
      querySucceeded: true,
      className: result.className,
      methodName: result.methodName,
      methodFound: result.methodFound,
      sourceAvailable: result.sourceAvailable,
      overloads: projectedOverloads,
      provenance: wantsFullProv ? result.provenance : projectProvenance(result.provenance, query.include as string[] | undefined),
    };
    if (!result.methodFound) {
      return returnFullGuided(
        `No overloads for ${result.methodName} on ${result.className}.`,
        payload,
        guidedEnvelope(buildMethodNotFoundOnClassMessage(result.className, result.methodName), true),
      );
    }
    return returnFullPlain(
      `Found ${result.overloads.length} overload(s) for ${result.methodName} on ${result.className}.`,
      payload,
    );
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
  query: ClassStructureQueryContext,
): CallToolResult {
  const detail = toolResponseDetail(query.full);
  if (result.ok) {
    if (detail === 'compact') {
      const scope: ClassStructureScopeType =
        query.scope && query.scope !== 'full' ? query.scope : 'overview';
      return returnCompactPlain(
        formatClassStructureText(result, {
          scope,
          classPurpose: result.classPurpose ?? null,
        }),
      );
    }
    const scope: ClassStructureScopeType =
      query.scope && query.scope !== 'full' ? query.scope : 'overview';
    const projected = projectClassStructure(result, {
      scope,
      include: query.include,
    });
    return returnFullPlain(formatClassStructureSummaryLine(result), projected as Record<string, unknown>);
  }

  if (result.error.code === 'CLASS_NOT_FOUND') {
    return mcpClassStructureNotFoundResult(result.error, query);
  }

  return mcpFailureResult(result.error, query, pickDiag(result));
}

function mcpClassStructureNotFoundResult(
  error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>,
  query: ClassStructureQueryContext,
): CallToolResult {
  return mcpNotFoundResult(error, query);
}

function mcpMethodSignatureNotFoundResult(
  error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>,
  query: MethodSignatureQueryContext,
): CallToolResult {
  return mcpNotFoundResult(error, { ...query, methodName: query.methodName });
}

function mcpNotFoundResult(
  error: Extract<ClassSourceError, { code: 'CLASS_NOT_FOUND' }>,
  query: ClassSourceQueryContext & { methodName?: string },
): CallToolResult {
  const detail = toolResponseDetail(query.full);
  const scope = formatClasspathScope(query);
  const env = classNotFoundEnvelope(error, query);
  const text = `No class found for ${JSON.stringify(error.className)} after scanning ${error.searchedArtifactCount} artifact(s)${scope}.`;
  if (detail === 'compact') {
    return returnCompactGuided(text, env);
  }

  const basePayload = {
    ok: true as const,
    found: false as const,
    className: error.className,
    searchedArtifactCount: error.searchedArtifactCount,
    querySucceeded: true as const,
    code: 'CLASS_NOT_FOUND' as const,
    message: env.message,
  };

  const payload =
    query.methodName !== undefined
      ? ({ ...basePayload, methodName: query.methodName } satisfies McpMethodSignatureNotFoundPayload)
      : (basePayload satisfies McpClassSourceNotFoundPayload | McpClassStructureNotFoundPayload);

  return returnFullGuided(text, payload, env);
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

function buildMcpErrorCallResult(summary: string, payload: McpClassSourceFailurePayload): CallToolResult {
  const env: GuidedEnvelopeFields = {
    message: payload.message,
    errorCategory: payload.errorCategory,
    found: false,
    querySucceeded: false,
  };
  return {
    isError: true,
    content: [{ type: 'text', text: summary }],
    structuredContent: withGuidedEnvelope(payload, env),
    errorCategory: payload.errorCategory,
    isRetryable: payload.isRetryable,
    message: payload.message,
  } as CallToolResult;
}
