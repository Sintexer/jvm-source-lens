/** Default max UTF-16 code units returned for a single class source body (CLI/MCP/library). */
export const DEFAULT_MAX_SOURCE_OUTPUT_CHARS = 512 * 1024;

export type CapSourceTextResult = {
  text: string;
  truncated: boolean;
  originalLength: number;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

export function maxSourceOutputChars(): number {
  return parsePositiveIntEnv('JVMSRC_MAX_SOURCE_OUTPUT_CHARS', DEFAULT_MAX_SOURCE_OUTPUT_CHARS);
}

/**
 * Truncates oversized source text for agent/CLI responses. Prefer `methodNames` / line
 * excerpts before relying on the cap.
 */
export function capSourceText(source: string, maxChars: number = maxSourceOutputChars()): CapSourceTextResult {
  const originalLength = source.length;
  if (originalLength <= maxChars) {
    return { text: source, truncated: false, originalLength };
  }
  const suffix =
    `\n\n/* jvmsrc: output truncated (${originalLength} chars). ` +
    `Use methodNames or startLine/endLine, or JVMSRC_MAX_SOURCE_OUTPUT_CHARS. */\n`;
  const bodyBudget = Math.max(0, maxChars - suffix.length);
  let text = source.slice(0, bodyBudget) + suffix;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }
  return {
    text,
    truncated: true,
    originalLength,
  };
}
