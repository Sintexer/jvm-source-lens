export const DEFAULT_FIND_CONTEXT_LINES = 3;
export const DEFAULT_FIND_MAX_HITS = 20;
export const MAX_FIND_MAX_HITS = 100;
export const MAX_FIND_QUERY_LENGTH = 500;
/** Upper bound on compilation-unit size scanned for find-in-source (bytes). */
export const MAX_FIND_SOURCE_BYTES = 8 * 1024 * 1024;

export type ClassSourceTextSearchHit = {
  /** 1-based line of match start. */
  line: number;
  /** 1-based column of match start. */
  column: number;
  matchedText: string;
  /** Present when the match spans more than one line. */
  block?: { startLine: number; endLine: number };
  contextBefore: string[];
  contextAfter: string[];
};

export type ClassSourceTextSearchResult = {
  hits: ClassSourceTextSearchHit[];
  totalMatches: number;
  truncated: boolean;
};

export type ClassSourceTextSearchOptions = {
  query: string;
  contextLines?: number;
  maxHits?: number;
  regex?: boolean;
};

export type ClassSourceTextSearchError =
  | { code: 'FIND_QUERY_INVALID'; message: string }
  | { code: 'FIND_SOURCE_TOO_LARGE'; message: string; byteLength: number };

function clampContextLines(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) {
    return DEFAULT_FIND_CONTEXT_LINES;
  }
  const v = Math.floor(n);
  if (v < 0) {
    return 0;
  }
  if (v > 50) {
    return 50;
  }
  return v;
}

function clampMaxHits(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) {
    return DEFAULT_FIND_MAX_HITS;
  }
  const v = Math.floor(n);
  if (v < 1) {
    return 1;
  }
  if (v > MAX_FIND_MAX_HITS) {
    return MAX_FIND_MAX_HITS;
  }
  return v;
}

export function buildLineIndex(source: string): { lines: string[]; lineStarts: number[] } {
  const lines: string[] = [];
  const lineStarts: number[] = [];
  let lineStart = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === '\n') {
      let end = i;
      if (end > lineStart && source[end - 1] === '\r') {
        end--;
      }
      lines.push(source.slice(lineStart, end));
      lineStarts.push(lineStart);
      lineStart = i + 1;
    }
  }
  return { lines, lineStarts };
}

function offsetToLineColumn(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (lineStarts[mid]! > offset) {
      hi = mid - 1;
    } else {
      lo = mid;
    }
  }
  return { line: lo + 1, column: offset - lineStarts[lo]! + 1 };
}

function hitFromRange(
  source: string,
  lines: string[],
  lineStarts: number[],
  startOffset: number,
  endOffset: number,
  contextLines: number,
): ClassSourceTextSearchHit {
  const matchedText = source.slice(startOffset, endOffset);
  const startPos = offsetToLineColumn(lineStarts, startOffset);
  const endPos = offsetToLineColumn(lineStarts, Math.max(startOffset, endOffset - 1));
  const block =
    endPos.line > startPos.line ? { startLine: startPos.line, endLine: endPos.line } : undefined;

  const blockStartLine = block?.startLine ?? startPos.line;
  const blockEndLine = block?.endLine ?? startPos.line;

  const beforeStart = Math.max(0, blockStartLine - 1 - contextLines);
  const beforeEnd = blockStartLine - 2;
  const contextBefore =
    beforeEnd >= beforeStart ? lines.slice(beforeStart, beforeEnd + 1) : [];

  const afterStart = blockEndLine;
  const afterEnd = Math.min(lines.length - 1, blockEndLine - 1 + contextLines);
  const contextAfter =
    afterStart <= afterEnd ? lines.slice(afterStart, afterEnd + 1) : [];

  return {
    line: startPos.line,
    column: startPos.column,
    matchedText,
    ...(block !== undefined ? { block } : {}),
    contextBefore,
    contextAfter,
  };
}

function searchLiteral(
  source: string,
  lines: string[],
  lineStarts: number[],
  query: string,
  contextLines: number,
  maxHits: number,
): ClassSourceTextSearchResult {
  const hits: ClassSourceTextSearchHit[] = [];
  let totalMatches = 0;
  let idx = 0;
  while (idx <= source.length - query.length) {
    const at = source.indexOf(query, idx);
    if (at < 0) {
      break;
    }
    totalMatches++;
    if (hits.length < maxHits) {
      hits.push(hitFromRange(source, lines, lineStarts, at, at + query.length, contextLines));
    }
    idx = at + 1;
  }
  return { hits, totalMatches, truncated: totalMatches > hits.length };
}

function searchRegex(
  source: string,
  lines: string[],
  lineStarts: number[],
  pattern: string,
  contextLines: number,
  maxHits: number,
): ClassSourceTextSearchResult | { error: ClassSourceTextSearchError } {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'g');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: { code: 'FIND_QUERY_INVALID', message: `Invalid regex: ${msg}` } };
  }

  const hits: ClassSourceTextSearchHit[] = [];
  let totalMatches = 0;
  const maxIterations = maxHits + 10_000;
  let iterations = 0;

  let m: RegExpExecArray | null;
  while (iterations < maxIterations) {
    m = re.exec(source);
    if (!m) {
      break;
    }
    iterations++;
    const at = m.index;
    const text = m[0];
    if (text.length === 0) {
      if (re.lastIndex === at) {
        re.lastIndex = at + 1;
      }
      continue;
    }
    totalMatches++;
    if (hits.length < maxHits) {
      hits.push(hitFromRange(source, lines, lineStarts, at, at + text.length, contextLines));
    }
  }

  if (iterations >= maxIterations) {
    return {
      hits,
      totalMatches: Math.max(totalMatches, hits.length),
      truncated: true,
    };
  }

  return { hits, totalMatches, truncated: totalMatches > hits.length };
}

export function searchClassSourceText(
  source: string,
  options: ClassSourceTextSearchOptions,
): ClassSourceTextSearchResult | { error: ClassSourceTextSearchError } {
  const query = options.query;
  if (query.length === 0) {
    return { error: { code: 'FIND_QUERY_INVALID', message: 'query must be non-empty' } };
  }
  if (query.length > MAX_FIND_QUERY_LENGTH) {
    return {
      error: {
        code: 'FIND_QUERY_INVALID',
        message: `query exceeds ${MAX_FIND_QUERY_LENGTH} characters`,
      },
    };
  }

  const byteLength = Buffer.byteLength(source, 'utf8');
  if (byteLength > MAX_FIND_SOURCE_BYTES) {
    return {
      error: {
        code: 'FIND_SOURCE_TOO_LARGE',
        message: `compilation unit exceeds ${MAX_FIND_SOURCE_BYTES} bytes for find-in-source`,
        byteLength,
      },
    };
  }

  const contextLines = clampContextLines(options.contextLines);
  const maxHits = clampMaxHits(options.maxHits);
  const { lines, lineStarts } = buildLineIndex(source);

  if (options.regex) {
    const r = searchRegex(source, lines, lineStarts, query, contextLines, maxHits);
    if ('error' in r) {
      return r;
    }
    return r;
  }

  return searchLiteral(source, lines, lineStarts, query, contextLines, maxHits);
}
