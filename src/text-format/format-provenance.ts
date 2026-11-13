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
  const nested = 'nestedIn' in p && p.nestedIn ? `; nested in ${p.nestedIn}` : '';
  switch (p.kind) {
    case 'classpathJar':
    case 'sourcesJar':
    case 'decompiled':
      return `Provenance: ${coord} (${p.kind})${nested}`;
    case 'interproject':
      return `Provenance: interproject ${p.moduleName}${nested}`;
    case 'interprojectSource':
      return `Provenance: interproject ${p.moduleName}${nested}`;
    case 'interprojectBytecode':
      return `Provenance: interproject ${p.moduleName} bytecode`;
    default:
      return `Provenance: ${coord}${nested}`;
  }
}
