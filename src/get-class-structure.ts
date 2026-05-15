import {
  declaringSimpleName,
  parseJavapClassHeader,
  parseJavapFields,
  parseJavapVerboseAllMethods,
} from './class-structure/javap-parse.js';
import { mergeDeclaredWithInheritedLayers } from './class-structure/inherited-methods.js';
import { parseJavaClassSkeleton, pickMethodJavadoc } from './class-structure/parse-java-class-skeleton.js';
import { spawnJavapVerbose } from './class-structure/spawn-javap.js';
import type {
  ClassStructureField,
  ClassStructureMethod,
  GetClassStructureResult,
  JavapClassHeader,
  JavapFieldInfo,
  JavapMethodWithName,
} from './class-structure/types.js';
import type { ArtifactCoordinates, ClassSourceLookupOptions } from './extractor/class-source-types.js';
import { findExternalJarOwningClass } from './extractor/find-external-class-jar.js';
import { tryReadPrimaryJavaSourceFromArtifacts } from './extractor/read-primary-java-source.js';
import { resolveSourcesJar } from './resolvers/gradle/resolve-sources-jar.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';
import type { JavaClassSkeleton } from './class-structure/parse-java-class-skeleton.js';

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
  return {
    name: displayName,
    jvmMethodName: o.jvmMethodName,
    declaringClass,
    visibility: o.visibility,
    returnType: o.jvmMethodName === '<init>' ? '' : (o.returnTypeDisplay ?? ''),
    parameters: o.parameters.map((p) => ({ name: p.name, type: p.typeDisplay })),
    typeParameters: [],
    javadoc,
    abstract: Boolean(o.flagsLine?.includes('ACC_ABSTRACT')),
    static: Boolean(o.flagsLine?.includes('ACC_STATIC')),
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
  return {
    name,
    declaringClass,
    visibility: f.visibility,
    type,
    static: Boolean(f.flagsLine?.includes('ACC_STATIC')),
    final: Boolean(f.flagsLine?.includes('ACC_FINAL')),
    enumConstant: f.enumConstant,
    javadoc,
  };
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

  const jarHit = findExternalJarOwningClass(resolved.output, {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!jarHit.ok) {
    return jarHit;
  }

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

  let sourceReadHit: { hit: true; sourceText: string } | { hit: false } = { hit: false };
  try {
    const src = await tryReadPrimaryJavaSourceFromArtifacts(resolved.output, {
      ...lookupOpts,
      resolveSourcesJar: resolveSourcesJarFn,
    });
    if (!src.ok) {
      return src;
    }
    sourceReadHit = src.hit ? { hit: true, sourceText: src.sourceText } : { hit: false };
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

  const sourceAvailable = sourceReadHit.hit === true;
  const skeleton =
    sourceReadHit.hit === true ? parseJavaClassSkeleton(sourceReadHit.sourceText, className) : null;

  const primaryJavap = await spawnJavapVerbose({
    jarPath: jarHit.hit.jarPath,
    className,
  });
  if (!primaryJavap.ok) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: primaryJavap.message,
        className,
        jarPath: jarHit.hit.jarPath,
        stderr: primaryJavap.stderr,
      },
    };
  }

  const primaryHeader = parseJavapClassHeader(primaryJavap.stdout);
  if (!primaryHeader) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: 'Could not parse class header from javap output',
        className,
        jarPath: jarHit.hit.jarPath,
      },
    };
  }

  const javapCache = new Map<string, string>([[className, primaryJavap.stdout]]);
  const headerCache = new Map<string, JavapClassHeader>([[className, primaryHeader]]);

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
    const superJar = findExternalJarOwningClass(resolved.output, {
      className: fqn,
      modulePath: opts.modulePath,
      configuration: opts.configuration,
      includeTest: opts.includeTest,
    });
    if (!superJar.ok) {
      continue;
    }

    const jp = await spawnJavapVerbose({
      jarPath: superJar.hit.jarPath,
      className: fqn,
    });
    if (!jp.ok) {
      return {
        ok: false,
        error: {
          code: 'SIGNATURE_EXTRACT_FAILED',
          message: jp.message,
          className: fqn,
          jarPath: superJar.hit.jarPath,
          stderr: jp.stderr,
        },
      };
    }

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

  const declaredRaw = parseJavapVerboseAllMethods(primaryJavap.stdout, className, { includeStatic: true });
  const declared = declaredRaw.map((m) =>
    javapMethodToStructure(m, className, false, sourceAvailable, skeleton),
  );

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
  function walkIface(i: string): void {
    if (ifaceSeen.has(i) || i === 'java.lang.Object') {
      return;
    }
    ifaceSeen.add(i);
    const h = headerCache.get(i);
    if (h) {
      for (const p of h.directInterfaces) {
        walkIface(p);
      }
    }
    ifaceOrdered.push(i);
  }
  for (const di of primaryHeader.directInterfaces) {
    walkIface(di);
  }

  const inheritedLayers: ClassStructureMethod[][] = [];
  for (const fqn of classLayersOrderedFarToNear) {
    const text = javapCache.get(fqn);
    if (!text) {
      continue;
    }
    const layerRaw = parseJavapVerboseAllMethods(text, fqn, {
      visibilityIn: ['public', 'protected'],
      includeStatic: false,
    });
    inheritedLayers.push(
      layerRaw
        .filter((m) => m.jvmMethodName !== '<init>')
        .map((m) => javapMethodToStructure(m, fqn, true, false, null)),
    );
  }

  for (const fqn of ifaceOrdered) {
    const text = javapCache.get(fqn);
    if (!text) {
      continue;
    }
    const layerRaw = parseJavapVerboseAllMethods(text, fqn, {
      visibilityIn: ['public', 'protected'],
      includeStatic: false,
    });
    inheritedLayers.push(
      layerRaw
        .filter((m) => m.jvmMethodName !== '<init>')
        .map((m) => javapMethodToStructure(m, fqn, true, false, null)),
    );
  }

  const methods = mergeDeclaredWithInheritedLayers(declared, inheritedLayers);

  const rawFields = parseJavapFields(primaryJavap.stdout);
  const fields = rawFields.map((f) => javapFieldToStructure(f, className, skeleton, sourceAvailable));

  const provenance = {
    kind: 'classpathJar' as const,
    coordinates: jarHit.hit.coordinates,
    jarPath: jarHit.hit.jarPath,
  };

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
