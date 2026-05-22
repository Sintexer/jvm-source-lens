/** Compact = plain text for agents; full = structured JSON (legacy MCP / CLI --json). */
export type ResponseDetail = 'compact' | 'full';

export function resolveResponseDetail(full?: boolean): ResponseDetail {
  return full === true ? 'full' : 'compact';
}

export function readDefaultDetailFromEnv(): ResponseDetail | undefined {
  const v = process.env.JVMSRC_DEFAULT_DETAIL?.trim().toLowerCase();
  if (v === 'full') {
    return 'full';
  }
  if (v === 'compact') {
    return 'compact';
  }
  return undefined;
}

export function resolveResponseDetailWithEnv(full?: boolean): ResponseDetail {
  if (full !== undefined) {
    return resolveResponseDetail(full);
  }
  return readDefaultDetailFromEnv() ?? 'compact';
}
