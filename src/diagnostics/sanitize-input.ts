const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~-]+\b/gi,
  /\bpassword\s*=\s*[^\s&]+/gi,
  /\bPASS(?:WORD)?\s*[:=]\s*\S+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
];

/** Strip obviously sensitive substrings from free-form text fields. */
export function redactSecretsInString(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[redacted]');
  }
  return out;
}

const MAX_ARRAY_ITEMS = 20;
const MAX_ARRAY_ITEM_CHARS = 200;

const ALLOWED_INPUT_KEYS = new Set([
  'projectRoot',
  'className',
  'methodName',
  'methodNames',
  'startLine',
  'endLine',
  'query',
  'regex',
  'contextLines',
  'maxHits',
  'modulePath',
  'configuration',
  'includeTest',
  'forceRefresh',
  'operation',
  'scope',
  'full',
  'jarPath',
  'maxClasses',
]);

/**
 * Builds a safe `input` object for diagnostics: allowlisted keys only, primitives serialized, no env dump.
 */
export function sanitizeDiagnosticInput(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_INPUT_KEYS.has(k)) {
      continue;
    }
    if (v === null || v === undefined) {
      out[k] = v;
      continue;
    }
    if (typeof v === 'string') {
      out[k] = redactSecretsInString(v.slice(0, 2048));
      continue;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      // e.g. `methodNames`: keep short strings (names are not secrets) so retry patterns are analyzable.
      out[k] = v
        .filter((x): x is string => typeof x === 'string')
        .slice(0, MAX_ARRAY_ITEMS)
        .map((x) => redactSecretsInString(x.slice(0, MAX_ARRAY_ITEM_CHARS)));
      continue;
    }
    out[k] = '[omitted]';
  }
  return out;
}
