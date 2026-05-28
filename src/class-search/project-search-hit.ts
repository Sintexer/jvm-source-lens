import type { ClassSearchHit, ClassSearchIndexMeta } from './types.js';

export type ClassSearchIncludeSection =
  | 'simpleName'
  | 'score'
  | 'origin'
  | 'coordinates'
  | 'location'
  | 'scope'
  | 'indexMeta'
  | 'all';

export type ProjectedSearchClassesHit = {
  className: string;
  libName: string;
  simpleName?: string;
  score?: number;
  origin?: ClassSearchHit['origin'];
  coordinates?: ClassSearchHit['coordinates'];
  jarPath?: string | null;
  moduleRoot?: string | null;
  interprojectModuleName?: string | null;
  moduleName?: string;
  configurationName?: string;
};

export function wantsSearchInclude(
  include: ClassSearchIncludeSection[] | undefined,
  section: ClassSearchIncludeSection,
): boolean {
  if (include === undefined || include.length === 0) {
    return false;
  }
  return include.includes('all') || include.includes(section);
}

export function deriveLibName(hit: ClassSearchHit): string {
  if (hit.origin === 'interproject') {
    return hit.interprojectModuleName ?? hit.moduleName;
  }
  if (hit.origin === 'local-file') {
    if (hit.coordinates.name.length > 0) {
      return hit.coordinates.name;
    }
    if (hit.jarPath) {
      const base = hit.jarPath.split(/[/\\]/).pop() ?? hit.jarPath;
      return base.endsWith('.jar') ? base.slice(0, -4) : base;
    }
    return hit.moduleName;
  }
  return hit.coordinates.name;
}

export function projectSearchClassesHit(
  hit: ClassSearchHit,
  include?: ClassSearchIncludeSection[],
): ProjectedSearchClassesHit {
  const projected: ProjectedSearchClassesHit = {
    className: hit.className,
    libName: deriveLibName(hit),
  };

  if (wantsSearchInclude(include, 'all')) {
    return {
      ...projected,
      simpleName: hit.simpleName,
      score: hit.score,
      origin: hit.origin,
      coordinates: hit.coordinates,
      jarPath: hit.jarPath,
      moduleRoot: hit.moduleRoot,
      interprojectModuleName: hit.interprojectModuleName,
      moduleName: hit.moduleName,
      configurationName: hit.configurationName,
    };
  }

  if (wantsSearchInclude(include, 'simpleName')) {
    projected.simpleName = hit.simpleName;
  }
  if (wantsSearchInclude(include, 'score')) {
    projected.score = hit.score;
  }
  if (wantsSearchInclude(include, 'origin')) {
    projected.origin = hit.origin;
  }
  if (wantsSearchInclude(include, 'coordinates')) {
    projected.coordinates = hit.coordinates;
  }
  if (wantsSearchInclude(include, 'location')) {
    projected.jarPath = hit.jarPath;
    projected.moduleRoot = hit.moduleRoot;
    projected.interprojectModuleName = hit.interprojectModuleName;
  }
  if (wantsSearchInclude(include, 'scope')) {
    projected.moduleName = hit.moduleName;
    projected.configurationName = hit.configurationName;
  }

  return projected;
}

export function shouldIncludeSearchIndexMeta(include?: ClassSearchIncludeSection[]): boolean {
  return wantsSearchInclude(include, 'indexMeta') || wantsSearchInclude(include, 'all');
}

export function projectSearchClassesIndexMeta(
  indexMeta: ClassSearchIndexMeta,
  include?: ClassSearchIncludeSection[],
): ClassSearchIndexMeta | undefined {
  return shouldIncludeSearchIndexMeta(include) ? indexMeta : undefined;
}
