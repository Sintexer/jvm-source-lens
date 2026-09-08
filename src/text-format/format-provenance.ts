import type { ClassStructureProvenance, MethodSignatureProvenance } from '../class-structure/types.js';
import type {
  DecompiledProvenance,
  InterprojectProvenance,
  SourcesJarProvenance,
} from '../extractor/class-source-types.js';

export function formatProvenanceLine(
  p:
    | ClassStructureProvenance
    | MethodSignatureProvenance
    | SourcesJarProvenance
    | DecompiledProvenance
    | InterprojectProvenance,
): string {
  const c = p.coordinates;
  const coord = `${c.group}:${c.name}:${c.version ?? ''}`;
  switch (p.kind) {
    case 'classpathJar':
    case 'sourcesJar':
    case 'decompiled':
      return `Provenance: ${coord} (${p.kind})`;
    case 'interproject':
      return `Provenance: interproject ${p.moduleName}`;
    case 'interprojectSource':
      return `Provenance: interproject ${p.moduleName}`;
    case 'interprojectBytecode':
      return `Provenance: interproject ${p.moduleName} bytecode`;
    default:
      return `Provenance: ${coord}`;
  }
}
