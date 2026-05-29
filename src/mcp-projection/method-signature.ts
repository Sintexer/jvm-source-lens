/**
 * Projection helpers for get_method_signature MCP tool responses.
 *
 * Default full=true JSON per overload: declarationLine only.
 *
 * Opt-in via include:
 *   'parameters'   → parameters[] with name/type
 *   'exceptions'   → thrownExceptions[]
 *   'jvmDescriptor'→ jvmDescriptor + genericSignature + flagsLine
 *   'provenance'   → full provenance object (not slim)
 *   'all'          → all opt-in fields
 */

import type { McpMethodSignatureSuccessPayload } from '../mcp-tool-result.js';

export type MethodSignatureIncludeSection = 'parameters' | 'exceptions' | 'jvmDescriptor' | 'provenance' | 'all';

export function wantsMethodSigInclude(
  include: MethodSignatureIncludeSection[] | undefined,
  s: MethodSignatureIncludeSection,
): boolean {
  if (!include || include.length === 0) return false;
  return include.includes('all') || include.includes(s);
}

export type ProjectedOverload = {
  declarationLine: string;
  visibility?: 'public' | 'protected' | 'package' | 'private';
  returnTypeDisplay?: string | null;
  parameters?: Array<{ name: string | null; typeDisplay: string }>;
  thrownExceptions?: string[];
  jvmDescriptor?: string;
  genericSignature?: string | null;
  flagsLine?: string | null;
};

export function projectOverload(
  o: McpMethodSignatureSuccessPayload['overloads'][number],
  include?: MethodSignatureIncludeSection[],
): ProjectedOverload {
  const projected: ProjectedOverload = {
    declarationLine: o.declarationLine,
  };

  if (wantsMethodSigInclude(include, 'parameters')) {
    projected.visibility = o.visibility;
    projected.returnTypeDisplay = o.returnTypeDisplay;
    projected.parameters = o.parameters;
  }

  if (wantsMethodSigInclude(include, 'exceptions')) {
    projected.thrownExceptions = o.thrownExceptions;
  }

  if (wantsMethodSigInclude(include, 'jvmDescriptor')) {
    if (o.jvmDescriptor !== undefined) projected.jvmDescriptor = o.jvmDescriptor;
    if (o.genericSignature !== undefined) projected.genericSignature = o.genericSignature;
    if (o.flagsLine !== undefined) projected.flagsLine = o.flagsLine;
  }

  return projected;
}
