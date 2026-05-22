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
      return `Provenance: ${coord} (${p.jarPath})`;
    case 'interproject':
      return `Provenance: interproject ${p.moduleName} (${p.moduleRoot})`;
    case 'interprojectSource':
      return `Provenance: interproject ${p.moduleName} (${p.absoluteSourcePath})`;
    case 'interprojectBytecode':
      return `Provenance: interproject ${p.moduleName} bytecode (${p.classpathRoot})`;
    default:
      return `Provenance: ${coord}`;
  }
}
