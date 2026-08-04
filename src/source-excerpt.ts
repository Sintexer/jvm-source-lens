import { collectMethodSourceSpans } from './class-structure/parse-java-type-metadata.js';

export type SourceExcerptRequest = {
  /** Simple or JVM names; use `<init>` for constructors. Order preserved for output. */
  methodNames?: string[];
  /** 1-based inclusive line in the full compilation unit. */
  startLine?: number;
  /** 1-based inclusive line in the full compilation unit. */
  endLine?: number;
};

/** One `methodNames` entry resolved from a superclass/interface, not the requested class's own compilation unit. */
export type InheritedExcerptInfo = {
  methodName: string;
  declaringClass: string;
};

export type SourceExcerptInfo = {
  excerpted: true;
  requestedMethodNames: string[];
  matchedMethodNames: string[];
  unmatchedMethodNames: string[];
  startLine?: number;
  endLine?: number;
  /** False when `sourceAvailable` was false (CFR); line-based slices are best-effort. */
  lineNumbersReliable: boolean;
  sourceLineCount: number;
  /** Present when one or more `matchedMethodNames` were found on a superclass/interface instead of the requested class. */
  inheritedExcerpts?: InheritedExcerptInfo[];
};

export type SourceExcerptError =
  | {
      code: 'EXCERPT_REQUEST_INVALID';
      message: string;
    }
  | {
      code: 'EXCERPT_NOT_FOUND';
      message: string;
      className: string;
      requestedMethodNames: string[];
      unmatchedMethodNames: string[];
    };

export type ApplySourceExcerptResult =
  | { ok: true; source: string; excerpt: SourceExcerptInfo }
  | { ok: false; error: SourceExcerptError };

export function normalizeSourceExcerptRequest(raw: SourceExcerptRequest): SourceExcerptRequest | null {
  const methodNames = raw.methodNames?.map((n) => n.trim()).filter((n) => n.length > 0);
  const hasMethods = methodNames !== undefined && methodNames.length > 0;
  const hasLines = raw.startLine !== undefined || raw.endLine !== undefined;
  if (!hasMethods && !hasLines) {
    return null;
  }
  return {
    methodNames: hasMethods ? dedupePreserveOrder(methodNames!) : undefined,
    startLine: raw.startLine,
    endLine: raw.endLine,
  };
}

export function mergeSourceExcerptInputs(
  methodNames?: string[],
  methodName?: string,
): string[] | undefined {
  const merged: string[] = [];
  if (methodName !== undefined && methodName.trim().length > 0) {
    merged.push(methodName.trim());
  }
  if (methodNames !== undefined) {
    for (const n of methodNames) {
      const t = n.trim();
      if (t.length > 0) {
        merged.push(t);
      }
    }
  }
  if (merged.length === 0) {
    return undefined;
  }
  return dedupePreserveOrder(merged);
}

function dedupePreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function lineCount(source: string): number {
  if (source.length === 0) {
    return 0;
  }
  let n = 1;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      n++;
    }
  }
  return n;
}

function lineRangeToOffsets(source: string, startLine: number, endLine: number): { start: number; end: number } | null {
  if (startLine < 1 || endLine < 1 || startLine > endLine) {
    return null;
  }
  let line = 1;
  let start = 0;
  let end = source.length;
  let foundStart = false;
  for (let i = 0; i <= source.length; i++) {
    if (line === startLine && !foundStart) {
      start = i;
      foundStart = true;
    }
    if (line === endLine + 1) {
      end = i;
      break;
    }
    if (i === source.length) {
      break;
    }
    if (source[i] === '\n') {
      line++;
    }
  }
  if (!foundStart) {
    return null;
  }
  return { start, end };
}

/** Joins non-adjacent excerpted spans (primary or inherited) in the final source text. */
export const EXCERPT_BOUNDARY_MARKER = '\n\n// --- jvmsrc excerpt boundary ---\n\n';

type Span = { start: number; end: number };

function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) {
    return [];
  }
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function sliceMergedSpans(source: string, spans: Span[]): string {
  const parts: string[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    parts.push(source.slice(s.start, s.end));
    if (i < spans.length - 1) {
      parts.push(EXCERPT_BOUNDARY_MARKER);
    }
  }
  return parts.join('');
}

function validateLineRange(startLine?: number, endLine?: number): string | null {
  if (startLine === undefined && endLine === undefined) {
    return null;
  }
  if (startLine === undefined || endLine === undefined) {
    return 'startLine and endLine must both be set for a line-range excerpt';
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return 'startLine and endLine must be integers';
  }
  if (startLine < 1 || endLine < 1) {
    return 'startLine and endLine must be >= 1';
  }
  if (startLine > endLine) {
    return 'startLine must be <= endLine';
  }
  return null;
}

/**
 * Applies optional method and/or line-range excerpts to full compilation-unit source.
 * Returns the original string unchanged when `request` is null/empty.
 */
export function applySourceExcerpt(
  source: string,
  className: string,
  sourceAvailable: boolean,
  request: SourceExcerptRequest | null,
): ApplySourceExcerptResult | { ok: true; source: string; excerpt?: undefined } {
  const normalized = request === null ? null : normalizeSourceExcerptRequest(request);
  if (!normalized) {
    return { ok: true, source };
  }

  const lineErr = validateLineRange(normalized.startLine, normalized.endLine);
  if (lineErr) {
    return { ok: false, error: { code: 'EXCERPT_REQUEST_INVALID', message: lineErr } };
  }

  const requestedMethodNames = normalized.methodNames ?? [];
  const spans: Span[] = [];
  const matched = new Set<string>();
  const unmatched: string[] = [];

  if (requestedMethodNames.length > 0) {
    const collected = collectMethodSourceSpans(source, className);
    if (!collected) {
      return {
        ok: false,
        error: {
          code: 'EXCERPT_NOT_FOUND',
          message: `Could not locate type ${className} in source for method excerpt`,
          className,
          requestedMethodNames,
          unmatchedMethodNames: [...requestedMethodNames],
        },
      };
    }
    for (const name of requestedMethodNames) {
      const hits = collected.filter((s) => s.jvmMethodName === name);
      if (hits.length === 0) {
        unmatched.push(name);
        continue;
      }
      matched.add(name);
      for (const h of hits) {
        spans.push({ start: h.start, end: h.end });
      }
    }
    if (unmatched.length > 0 && matched.size === 0) {
      return {
        ok: false,
        error: {
          code: 'EXCERPT_NOT_FOUND',
          message: `No matching method(s) in ${className}: ${unmatched.join(', ')}`,
          className,
          requestedMethodNames,
          unmatchedMethodNames: unmatched,
        },
      };
    }
  }

  if (normalized.startLine !== undefined && normalized.endLine !== undefined) {
    const lr = lineRangeToOffsets(source, normalized.startLine, normalized.endLine);
    if (!lr) {
      return {
        ok: false,
        error: {
          code: 'EXCERPT_REQUEST_INVALID',
          message: `Line range ${normalized.startLine}-${normalized.endLine} is outside the file (${lineCount(source)} lines)`,
        },
      };
    }
    spans.push(lr);
  }

  const merged = mergeSpans(spans);
  if (merged.length === 0) {
    return {
      ok: false,
      error: {
        code: 'EXCERPT_REQUEST_INVALID',
        message: 'Excerpt request produced no source spans',
      },
    };
  }

  const excerptedSource = sliceMergedSpans(source, merged);
  const excerpt: SourceExcerptInfo = {
    excerpted: true,
    requestedMethodNames,
    matchedMethodNames: [...matched],
    unmatchedMethodNames: unmatched,
    ...(normalized.startLine !== undefined ? { startLine: normalized.startLine } : {}),
    ...(normalized.endLine !== undefined ? { endLine: normalized.endLine } : {}),
    lineNumbersReliable: sourceAvailable,
    sourceLineCount: lineCount(source),
  };

  return { ok: true, source: excerptedSource, excerpt };
}
