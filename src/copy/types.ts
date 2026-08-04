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
  /** Exact simple-name alternate FQNs (did-you-mean). */
  suggestions?: string[];
  /**
   * When modulePath was omitted on a multimodule project, concrete module names
   * from ResolutionOutput for the agent to retry with.
   */
  suggestedModulePaths?: string[];
};

/** Minimal query context for failure classification (resolution messages). */
export type ClassifyErrorQueryContext = {
  projectRoot: string;
};
