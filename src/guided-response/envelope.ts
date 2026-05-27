import type { GuidedEnvelopeFields } from './types.js';

export function withGuidedEnvelope<T extends Record<string, unknown>>(
  payload: T,
  fields: GuidedEnvelopeFields | OutcomeOnlySuccessFields,
): T & (GuidedEnvelopeFields | OutcomeOnlySuccessFields) {
  return { ...payload, ...fields };
}

export type OutcomeOnlySuccessFields = {
  found: boolean;
  querySucceeded: true;
  errorCategory: null;
};

/** Outcome flags for happy-path successes (no agent `message`). */
export function outcomeOnlySuccessFields(found = true): OutcomeOnlySuccessFields {
  return {
    found,
    querySucceeded: true,
    errorCategory: null,
  };
}

/** Agent-directed guidance for failures and empty results. */
export function guidedEnvelope(message: string, found: boolean, querySucceeded = true): GuidedEnvelopeFields {
  return {
    message,
    errorCategory: null,
    found,
    querySucceeded,
  };
}

/** @deprecated Use guidedEnvelope for empty results. */
export function successEnvelope(message: string, found: boolean, querySucceeded = true): GuidedEnvelopeFields {
  return guidedEnvelope(message, found, querySucceeded);
}

function hasGuidanceMessage(fields: GuidedEnvelopeFields | OutcomeOnlySuccessFields): fields is GuidedEnvelopeFields {
  return 'message' in fields && typeof fields.message === 'string' && fields.message.length > 0;
}

/** Appends agent-directed outcome footer for compact MCP responses (failures / empty only). */
export function appendGuidanceFooter(text: string, fields: GuidedEnvelopeFields | OutcomeOnlySuccessFields): string {
  if (!hasGuidanceMessage(fields)) {
    return text;
  }
  const lines = ['---'];
  if (fields.found !== undefined) {
    lines.push(`found: ${fields.found}`);
  }
  if (fields.querySucceeded !== undefined) {
    lines.push(`querySucceeded: ${fields.querySucceeded}`);
  }
  if (fields.errorCategory !== null && fields.errorCategory !== undefined) {
    lines.push(`errorCategory: ${fields.errorCategory}`);
  }
  lines.push(`message: ${fields.message}`);
  return `${text.trimEnd()}\n${lines.join('\n')}`;
}
