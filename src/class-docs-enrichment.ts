import { readClassJavadoc, type ClassJavadoc } from './class-javadoc.js';
import { isExternalJarArtifact } from './extractor/class-source-types.js';
import type { ClasspathOwningClassHit } from './extractor/find-external-class-jar.js';
import { resolverById } from './resolvers/index.js';

export type JavadocCache = Map<string, Promise<ClassJavadoc | null>>;

export async function readOwnerJavadoc(projectRoot: string, buildSystem: string, moduleName: string,
  owner: ClasspathOwningClassHit, className: string, cache?: JavadocCache): Promise<ClassJavadoc | null> {
  if (owner.kind !== 'externalJar' || !isExternalJarArtifact(owner.artifact)) return null;
  const c = owner.coordinates;
  const key = JSON.stringify([projectRoot, buildSystem, moduleName, c.group, c.name, c.version, owner.classpath, className]);
  const cached = cache?.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const result = await resolverById(buildSystem)?.resolveJavadocJar?.(projectRoot, c, moduleName);
    return result?.ok && result.javadocJarPath ? readClassJavadoc(result.javadocJarPath, className) : null;
  })().catch(() => null); // Classifier and page failures must not invalidate a bytecode answer.
  cache?.set(key, pending);
  return pending;
}

export function enrichMethodDocs<T extends { jvmDescriptor: string }>(page: ClassJavadoc, rows: T[], name: (row: T) => string): T[] {
  // javap filters synthetic/bridge methods. A doclet anchor still cannot distinguish
  // two remaining descriptors that differ only by return type.
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  const keys = rows.map(row => {
    const key = name(row) + row.jvmDescriptor.slice(0, row.jvmDescriptor.indexOf(')') + 1);
    if (seen.has(key)) ambiguous.add(key);
    seen.add(key);
    return key;
  });
  return rows.map((row, i) => {
    const javadoc = !ambiguous.has(keys[i]!) && page.methodDoc(name(row), row.jvmDescriptor);
    return javadoc ? { ...row, javadoc, docsSource: 'javadoc-jar' } : row;
  });
}
