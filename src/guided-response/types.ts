/** MCP agent recovery categories (transient / validation / business / permission). */
export type McpErrorCategory = 'transient' | 'validation' | 'business' | 'permission';

export type GuidedEnvelopeFields = {
  message: string;
  errorCategory: McpErrorCategory | null;
  querySucceeded?: boolean;
  found?: boolean;
};

export type { ClassNotFoundContext, GuidedQueryContext } from '../copy/types.js';
