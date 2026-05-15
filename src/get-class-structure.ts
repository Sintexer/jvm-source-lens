import {
  declaringSimpleName,
  parseJavapClassHeader,
  parseJavapFields,
  parseJavapVerboseAllMethods,
} from './class-structure/javap-parse.js';
import { mergeDeclaredWithInheritedLayers } from './class-structure/inherited-methods.js';
import { parseJavaClassSkeleton, pickMethodJavadoc, type JavaClassSkeleton } from './class-structure/parse-java-class-skeleton.js';
import type { ParsedJavaTypeHeader, ParsedJavaTypeMetadata } from './class-structure/parse-java-type-metadata.js';
import { parseJavaTypeMetadata } from './class-structure/parse-java-type-metadata.js';
import { spawnJavapVerbose } from './class-structure/spawn-javap.js';
import type {
  ClassStructureField,
  ClassStructureMethod,
  ClassStructureProvenance,
  GetClassStructureResult,
  JavapClassHeader,
  JavapFieldInfo,
  JavapMethodWithName,
} from './class-structure/types.js';
import type { ArtifactCoordinates, ClassSourceLookupOptions } from './extractor/class-source-types.js';
import { findClasspathOwningClass } from './extractor/find-external-class-jar.js';
import {
  tryReadJavaSourceFromClasspath,
  type TryReadJavaSourceFromClasspathResult,
} from './extractor/read-java-source-from-classpath.js';
import { resolveSourcesJar } from './resolvers/gradle/resolve-sources-jar.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

const MAX_GRAPH_VISITS = 64;

export type GetClassStructureOptions = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
};

function coordinatesKey(c: ArtifactCoordinates): string {
  return `${c.group}:${c.name}:${c.version ?? ''}`;
}

function parsedHeaderToJavapHeader(h: ParsedJavaTypeHeader, simple: string): JavapClassHeader {
  return {
    kind: h.kind,
    declarationLine: `${h.kind} ${simple}`,
    flagsLine: null,
    superClass: h.superClass,
    directInterfaces: h.directInterfaces,
    typeParameterNames: h.typeParameterNames,
  };
}

function buildClassStructureProvenance(args: {
  sourceRead: TryReadJavaSourceFromClasspathResult;
  ownerHit: ReturnType<typeof findClasspathOwningClass>;
}): ClassStructureProvenance {
  const { sourceRead, ownerHit } = args;
  if (!sourceRead.ok) {
    throw new Error('jvmsrc internal error: provenance requires resolved source read');
  }
  if (sourceRead.hit && sourceRead.provenance.kind === 'interproject') {
    const p = sourceRead.provenance;
    return {
      kind: 'interprojectSource',
      coordinates: p.coordinates,
      moduleName: p.moduleName,
      moduleRoot: p.moduleRoot,
      absoluteSourcePath: p.absoluteSourcePath,
      sourceRelativePath: p.sourceRelativePath,
    };
  }
  if (sourceRead.hit && sourceRead.provenance.kind === 'sourcesJar') {
    const p = sourceRead.provenance;
    return {
      kind: 'sourcesJar',
      coordinates: p.coordinates,
      jarPath: p.jarPath,
    };
  }
  if (!sourceRead.hit && ownerHit.ok && ownerHit.hit.kind === 'externalJar') {
    return {
      kind: 'classpathJar',
      coordinates: ownerHit.hit.coordinates,
      jarPath: ownerHit.hit.classpath,
    };
  }
  if (!sourceRead.hit && ownerHit.ok && ownerHit.hit.kind === 'interprojectBytecode') {
    return {
      kind: 'interprojectBytecode',
      coordinates: ownerHit.hit.coordinates,
      moduleName: ownerHit.hit.moduleName,
      moduleRoot: ownerHit.hit.moduleRoot,
      classpathRoot: ownerHit.hit.classpath,
    };
  }
  throw new Error('jvmsrc internal error: missing ClassStructure provenance');
}

function javapMethodToStructure(
  o: JavapMethodWithName,
  declaringClass: string,
  inherited: boolean,
  sourceAvailable: boolean,
  skeleton: JavaClassSkeleton | null,
): ClassStructureMethod {
  const displayName = o.jvmMethodName === '<init>' ? declaringSimpleName(declaringClass) : o.jvmMethodName;
  const paramCount = o.parameters.length;
  const javadoc =
    !inherited && sourceAvailable
      ? pickMethodJavadoc(skeleton, displayName, paramCount)
      : null;
  const decl = o.declarationLine;
  return {
    name: displayName,
    jvmMethodName: o.jvmMethodName,
    declaringClass,
    visibility: o.visibility,
    returnType: o.jvmMethodName === '<init>' ? '' : (o.returnTypeDisplay ?? ''),
    parameters: o.parameters.map((p) => ({ name: p.name, type: p.typeDisplay })),
    typeParameters: [],
    javadoc,
    abstract:
      Boolean(o.flagsLine?.includes('ACC_ABSTRACT')) ||
      Boolean(/\babstract\b/.test(decl)),
    static: Boolean(o.flagsLine?.includes('ACC_STATIC')) || Boolean(/\bstatic\b/.test(decl)),
    throws: o.thrownExceptions,
    genericSignature: o.genericSignature,
    jvmDescriptor: o.jvmDescriptor,
    inherited,
  };
}

function javapFieldToStructure(
  f: JavapFieldInfo,
  declaringClass: string,
  skeleton: JavaClassSkeleton | null,
  sourceAvailable: boolean,
): ClassStructureField {
  const decl = f.declarationLine.replace(/;$/, '').trim();
  const parts = decl.split(/\s+/).filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  const type = parts.slice(0, -1).join(' ').replace(/^static\s+/, '').replace(/^final\s+/, '').trim();
  let javadoc: string | null = null;
  if (sourceAvailable && skeleton && name.length > 0) {
    const hit = skeleton.methods.find((m) => m.name === name);
    javadoc = hit?.javadoc ?? null;
  }
  const dl = f.declarationLine;
  return {
    name,
    declaringClass,
    visibility: f.visibility,
    type,
    static: Boolean(f.flagsLine?.includes('ACC_STATIC')) || /\bstatic\b/.test(dl),
    final: Boolean(f.flagsLine?.includes('ACC_FINAL')) || /\bfinal\b/.test(dl),
    enumConstant: f.enumConstant,
    javadoc,
  };
}

function isInheritedInstanceApiMethod(m: JavapMethodWithName): boolean {
  if (m.jvmMethodName === '<init>') {
    return false;
  }
  if (/\bstatic\b/.test(m.declarationLine)) {
    return false;
  }
  return m.visibility === 'public' || m.visibility === 'protected';
}

export async function getClassStructure(
  className: string,
  opts: GetClassStructureOptions,
): Promise<GetClassStructureResult> {
  const resolved = await resolveWithResolutionCache(opts.projectRoot, {
    forceRefresh: Boolean(opts.forceRefresh),
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: { code: 'RESOLUTION_FAILED', message: resolved.message, stderr: resolved.stderr },
    };
  }

  const lookupOpts: ClassSourceLookupOptions = {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  };

  const sourcesJarCache = new Map<string, string | null>();
  const resolveSourcesJarFn = async (coordinates: ArtifactCoordinates): Promise<string | null> => {
    const key = coordinatesKey(coordinates);
    if (sourcesJarCache.has(key)) {
      return sourcesJarCache.get(key) ?? null;
    }
    const result = await resolveSourcesJar(opts.projectRoot, coordinates);
    if (!result.ok) {
      throw Object.assign(new Error(result.message), {
        code: 'SOURCES_RESOLVE_FAILED' as const,
        stderr: result.stderr,
        coordinates,
      });
    }
    const path = result.sourcesJarPath;
    sourcesJarCache.set(key, path);
    return path;
  };

  let sourceRead: TryReadJavaSourceFromClasspathResult;
  try {
    sourceRead = await tryReadJavaSourceFromClasspath(resolved.output, {
      ...lookupOpts,
      resolveSourcesJar: resolveSourcesJarFn,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string; stderr?: string; coordinates?: ArtifactCoordinates };
    if (err.code === 'SOURCES_RESOLVE_FAILED') {
      return {
        ok: false,
        error: {
          code: 'SOURCES_RESOLVE_FAILED',
          message: err.message ?? 'Failed to resolve sources JAR',
          stderr: err.stderr,
          coordinates: err.coordinates!,
        },
      };
    }
    throw e;
  }

  if (!sourceRead.ok) {
    return { ok: false, error: sourceRead.error };
  }

  const ownerHit = findClasspathOwningClass(resolved.output, {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });

  if (!ownerHit.ok && !sourceRead.hit) {
    return ownerHit;
  }

  let parsedPrimary: ParsedJavaTypeMetadata | null = null;
  if (sourceRead.hit) {
    parsedPrimary = parseJavaTypeMetadata(sourceRead.sourceText, className);
  }

  let primaryJavapStdout: string | null = null;
  if (ownerHit.ok) {
    const primaryJavap = await spawnJavapVerbose({
      classpath: ownerHit.hit.classpath,
      className,
    });
    if (primaryJavap.ok) {
      primaryJavapStdout = primaryJavap.stdout;
    }
  }

  let primaryHeader: JavapClassHeader | null = null;
  if (parsedPrimary) {
    primaryHeader = parsedHeaderToJavapHeader(parsedPrimary.header, declaringSimpleName(className));
  } else if (primaryJavapStdout) {
    primaryHeader = parseJavapClassHeader(primaryJavapStdout);
  }

  if (!primaryHeader) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message:
          'Could not obtain class header from Java source parse or javap — ensure the type is valid bytecode and/or readable source on the classpath.',
        className,
        jarPath: ownerHit.ok ? ownerHit.hit.classpath : '',
      },
    };
  }

  const sourceAvailable = sourceRead.hit === true;
  const skeleton =
    sourceRead.hit === true ? parseJavaClassSkeleton(sourceRead.sourceText, className) : null;

  const javapCache = new Map<string, string>();
  if (primaryJavapStdout) {
    javapCache.set(className, primaryJavapStdout);
  }
  const headerCache = new Map<string, JavapClassHeader>([[className, primaryHeader]]);
  const sourceMemberCache = new Map<string, ParsedJavaTypeMetadata>();
  if (parsedPrimary) {
    sourceMemberCache.set(className, parsedPrimary);
  }

  const visitQueue: string[] = [];
  const visitSeen = new Set<string>([className]);
  let visitsStarted = 0;

  function enqueue(fqn: string | null | undefined): void {
    if (!fqn || fqn === 'java.lang.Object') {
      return;
    }
    if (visitSeen.has(fqn)) {
      return;
    }
    visitSeen.add(fqn);
    visitQueue.push(fqn);
  }

  enqueue(primaryHeader.superClass);
  for (const i of primaryHeader.directInterfaces) {
    enqueue(i);
  }

  while (visitQueue.length > 0 && visitsStarted < MAX_GRAPH_VISITS) {
    const fqn = visitQueue.shift()!;
    if (javapCache.has(fqn)) {
      const h = headerCache.get(fqn);
      if (h) {
        enqueue(h.superClass);
        for (const x of h.directInterfaces) {
          enqueue(x);
        }
      }
      continue;
    }

    visitsStarted++;
    const superOwner = findClasspathOwningClass(resolved.output, {
      className: fqn,
      modulePath: opts.modulePath,
      configuration: opts.configuration,
      includeTest: opts.includeTest,
    });

    let jpCaptured = false;
    if (superOwner.ok) {
      const jp = await spawnJavapVerbose({
        classpath: superOwner.hit.classpath,
        className: fqn,
      });
      if (jp.ok) {
        jpCaptured = true;
        javapCache.set(fqn, jp.stdout);
        const hh = parseJavapClassHeader(jp.stdout);
        if (hh) {
          headerCache.set(fqn, hh);
          enqueue(hh.superClass);
          for (const x of hh.directInterfaces) {
            enqueue(x);
          }
        }
      }
    }

    if (!jpCaptured) {
      const srcSuper = await tryReadJavaSourceFromClasspath(resolved.output, {
        ...lookupOpts,
        className: fqn,
        resolveSourcesJar: resolveSourcesJarFn,
      });
      if (srcSuper.ok && srcSuper.hit) {
        const meta = parseJavaTypeMetadata(srcSuper.sourceText, fqn);
        if (meta) {
          sourceMemberCache.set(fqn, meta);
          headerCache.set(fqn, parsedHeaderToJavapHeader(meta.header, declaringSimpleName(fqn)));
          enqueue(meta.header.superClass);
          for (const x of meta.header.directInterfaces) {
            enqueue(x);
          }
        }
      }
    }
  }

  const declared = parsedPrimary
    ? parsedPrimary.methods.map((m) => javapMethodToStructure(m, className, false, sourceAvailable, skeleton))
    : primaryJavapStdout
      ? parseJavapVerboseAllMethods(primaryJavapStdout, className, { includeStatic: true }).map((m) =>
          javapMethodToStructure(m, className, false, sourceAvailable, skeleton),
        )
      : [];

  const classChainTowardsObject: string[] = [];
  let sc = primaryHeader.superClass;
  while (sc && sc !== 'java.lang.Object') {
    classChainTowardsObject.push(sc);
    const nh = headerCache.get(sc);
    if (!nh) {
      break;
    }
    sc = nh.superClass;
  }
  const classLayersOrderedFarToNear = [...classChainTowardsObject].reverse();

  const ifaceOrdered: string[] = [];
  const ifaceSeen = new Set<string>();
  function walkIface(iface: string): void {
    if (ifaceSeen.has(iface) || iface === 'java.lang.Object') {
      return;
    }
    ifaceSeen.add(iface);
    const h = headerCache.get(iface);
    if (h) {
      for (const p of h.directInterfaces) {
        walkIface(p);
      }
    }
    ifaceOrdered.push(iface);
  }
  for (const di of primaryHeader.directInterfaces) {
    walkIface(di);
  }

  function methodsForInheritedLayer(fqn: string): ClassStructureMethod[] {
    const text = javapCache.get(fqn);
    if (text) {
      const layerRaw = parseJavapVerboseAllMethods(text, fqn, {
        visibilityIn: ['public', 'protected'],
        includeStatic: false,
      });
      return layerRaw
        .filter((m) => m.jvmMethodName !== '<init>')
        .map((m) => javapMethodToStructure(m, fqn, true, false, null));
    }
    const meta = sourceMemberCache.get(fqn);
    if (!meta) {
      return [];
    }
    return meta.methods
      .filter(isInheritedInstanceApiMethod)
      .map((m) => javapMethodToStructure(m, fqn, true, false, null));
  }

  const inheritedLayers: ClassStructureMethod[][] = [];
  for (const fqn of classLayersOrderedFarToNear) {
    inheritedLayers.push(methodsForInheritedLayer(fqn));
  }

  for (const fqn of ifaceOrdered) {
    inheritedLayers.push(methodsForInheritedLayer(fqn));
  }

  const methods = mergeDeclaredWithInheritedLayers(declared, inheritedLayers);

  const rawFields: JavapFieldInfo[] = parsedPrimary
    ? parsedPrimary.fields
    : primaryJavapStdout
      ? parseJavapFields(primaryJavapStdout)
      : [];
  const fields = rawFields.map((f) => javapFieldToStructure(f, className, skeleton, sourceAvailable));

  const provenance = buildClassStructureProvenance({ sourceRead, ownerHit });

  return {
    ok: true,
    className,
    kind: primaryHeader.kind,
    superclass: primaryHeader.superClass,
    interfaces: primaryHeader.directInterfaces,
    typeParameters: primaryHeader.typeParameterNames,
    fields,
    methods,
    sourceAvailable,
    provenance,
  };
}
