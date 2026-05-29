/**
 * Projection helpers for find_in_class_source MCP tool responses.
 *
 * Default full=true JSON per hit: line, column, matchedText only.
 *
 * Opt-in via include:
 *   'context'    → contextBefore[] / contextAfter[]
 *   'block'      → block { startLine, endLine }
 *   'provenance' → full provenance object (not slim)
 *   'all'        → all opt-in fields
 */

import type { ClassSourceTextSearchHit } from '../class-source-text-search.js';

export type FindInClassIncludeSection = 'context' | 'block' | 'provenance' | 'all';

export function wantsFindInclude(
  include: FindInClassIncludeSection[] | undefined,
  s: FindInClassIncludeSection,
): boolean {
  if (!include || include.length === 0) return false;
  return include.includes('all') || include.includes(s);
}

export type ProjectedFindHit = {
  line: number;
  column: number;
  matchedText: string;
  block?: { startLine: number; endLine: number };
  contextBefore?: string[];
  contextAfter?: string[];
};

export function projectFindHit(h: ClassSourceTextSearchHit, include?: FindInClassIncludeSection[]): ProjectedFindHit {
  const projected: ProjectedFindHit = {
    line: h.line,
    column: h.column,
    matchedText: h.matchedText,
  };

  if (wantsFindInclude(include, 'block') && h.block !== undefined) {
    projected.block = h.block;
  }

  if (wantsFindInclude(include, 'context')) {
    projected.contextBefore = h.contextBefore;
    projected.contextAfter = h.contextAfter;
  }

  return projected;
}
