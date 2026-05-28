/** Classpath scope fields shared by empty-result and failure copy builders. */
export type GuidedQueryContext = {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
};

export type ClassNotFoundContext = GuidedQueryContext & {
  className: string;
  searchedArtifactCount: number;
  methodName?: string;
};

/** Minimal query context for failure classification (resolution messages). */
export type ClassifyErrorQueryContext = {
  projectRoot: string;
};
