/** MCP agent recovery categories (transient / validation / business / permission). */
export type McpErrorCategory = 'transient' | 'validation' | 'business' | 'permission';

export type GuidedQueryContext = {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
};

export type GuidedEnvelopeFields = {
  message: string;
  errorCategory: McpErrorCategory | null;
  querySucceeded?: boolean;
  found?: boolean;
};

export type ClassNotFoundContext = GuidedQueryContext & {
  className: string;
  searchedArtifactCount: number;
  methodName?: string;
};
