import { parseResolutionJson } from '../resolution-output.js';

export type SourcesJarResolveOutput = {
  sourcesJarPath: string | null;
};

export type SourcesJarParseResult =
  | { ok: true; output: SourcesJarResolveOutput }
  | { ok: false; message: string };

export function parseSourcesJarJson(text: string): SourcesJarParseResult {
  let raw: unknown;
  try {
    raw = parseResolutionJson(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Could not parse Gradle JSON output: ${msg}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Sources resolve output is not a JSON object' };
  }
  const o = raw as Record<string, unknown>;
  const path = o.sourcesJarPath;
  if (path !== null && path !== undefined && typeof path !== 'string') {
    return { ok: false, message: 'Invalid sourcesJarPath in Gradle output' };
  }
  return {
    ok: true,
    output: { sourcesJarPath: typeof path === 'string' ? path : null },
  };
}
