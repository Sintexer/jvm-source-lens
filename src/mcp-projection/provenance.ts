/**
 * Slim provenance projections for MCP tool responses.
 *
 * Default: libName (Maven artifactId or Gradle module name) only.
 * Opt-in via `include` tokens: 'location' (jarPath/moduleRoot), 'coordinates' (group:name:version).
 */

import type { ClassStructureProvenance, MethodSignatureProvenance } from '../class-structure/types.js';
import type {
  DecompiledProvenance,
  InterprojectProvenance,
  SourcesJarProvenance,
} from '../extractor/class-source-types.js';

export type AnyProvenance =
  | ClassStructureProvenance
  | MethodSignatureProvenance
  | SourcesJarProvenance
  | DecompiledProvenance
  | InterprojectProvenance;

/** Include tokens recognised by provenance projection helpers. */
export type ProvenanceIncludeSection = 'location' | 'coordinates' | 'provenance';

/** Minimal provenance shape — always present in slim projections. */
export type SlimProvenance = {
  /** Maven artifactId or Gradle module name. */
  libName: string;
  /** Provenance kind (e.g. 'sourcesJar', 'decompiled', 'interproject'). */
  kind: string;
  /** Artifact coordinates — present when 'coordinates' is in include. */
  coordinates?: { group: string; name: string; version: string | null };
  /** Absolute jar / source path — present when 'location' is in include. */
  location?: string;
};

export function wantsProvenanceInclude(
  include: string[] | undefined,
  section: ProvenanceIncludeSection,
): boolean {
  if (!include || include.length === 0) return false;
  return include.includes('all') || include.includes(section);
}

function deriveLibNameFromProvenance(p: AnyProvenance): string {
  if (p.kind === 'interproject' || p.kind === 'interprojectSource' || p.kind === 'interprojectBytecode') {
    return (p as { moduleName: string }).moduleName;
  }
  return p.coordinates.name;
}

function locationFromProvenance(p: AnyProvenance): string | undefined {
  switch (p.kind) {
    case 'classpathJar':
    case 'sourcesJar':
    case 'decompiled':
      return (p as { jarPath: string }).jarPath;
    case 'interproject':
    case 'interprojectSource':
      return (p as { absoluteSourcePath: string }).absoluteSourcePath;
    case 'interprojectBytecode':
      return (p as { classpathRoot: string }).classpathRoot;
    default:
      return undefined;
  }
}

/**
 * Project a provenance object into a slim shape.
 * By default: libName + kind.
 * Opt-in via include: 'coordinates', 'location'.
 */
export function projectProvenance(p: AnyProvenance, include?: string[]): SlimProvenance {
  const slim: SlimProvenance = {
    libName: deriveLibNameFromProvenance(p),
    kind: p.kind,
  };

  if (wantsProvenanceInclude(include, 'coordinates')) {
    slim.coordinates = { ...p.coordinates };
  }

  if (wantsProvenanceInclude(include, 'location')) {
    const loc = locationFromProvenance(p);
    if (loc !== undefined) {
      slim.location = loc;
    }
  }

  return slim;
}
