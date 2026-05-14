export { getBundledResource, type BundledResourceName } from '../bundled-resources.js';

export interface ResolveOptions {
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
}

export interface ResolvedArtifact {
  group: string;
  name: string;
  version: string;
  jarPath: string;
  sourcesJarPath?: string;
  scope: 'compile' | 'runtime' | 'test' | 'provided';
}

export interface ProjectModule {
  name: string;
  path: string;
  artifacts: ResolvedArtifact[];
}

export interface ResolvedDependencyTree {
  modules: ProjectModule[];
}

export interface DependencyResolver {
  detect(projectRoot: string): boolean;
  resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolvedDependencyTree>;
}
