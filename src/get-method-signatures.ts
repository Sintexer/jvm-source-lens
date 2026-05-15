import { extractClassMemberSection, parseJavapVerboseMethods } from './class-structure/javap-parse.js';
import { parseJavaTypeMetadata } from './class-structure/parse-java-type-metadata.js';
import { spawnJavapVerbose } from './class-structure/spawn-javap.js';
import type {
  JavapMethodOverload,
  JavapMethodWithName,
  MethodSignatureProvenance,
} from './class-structure/types.js';
import type {
  ArtifactCoordinates,
  ClassSourceError,
  ClassSourceLookupOptions,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
import { findClasspathOwningClass } from './extractor/find-external-class-jar.js';
import { tryReadJavaSourceFromClasspath } from './extractor/read-java-source-from-classpath.js';
import { resolveSourcesJar } from './resolvers/gradle/resolve-sources-jar.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

export type GetMethodSignatureOptions = {
  projectRoot: string;
  modulePath?: string;
  configuration?: string;
  includeTest?: boolean;
  forceRefresh?: boolean;
};

export type GetMethodSignatureSuccess = {
  ok: true;
  className: string;
  methodName: string;
  /** True when overloads were parsed from `.java` on the classpath (sources JAR or inter-project disk). */
  sourceAvailable: boolean;
  methodFound: boolean;
  overloads: JavapMethodOverload[];
  provenance: MethodSignatureProvenance;
};

export type GetMethodSignatureResult = GetMethodSignatureSuccess | { ok: false; error: ClassSourceError };

function coordinatesKey(c: ArtifactCoordinates): string {
  return `${c.group}:${c.name}:${c.version ?? ''}`;
}

function overloadFromParsedMethod(m: JavapMethodWithName): JavapMethodOverload {
  return {
    declarationLine: m.declarationLine,
    visibility: m.visibility,
    jvmDescriptor: m.jvmDescriptor,
    genericSignature: m.genericSignature,
    returnTypeDisplay: m.returnTypeDisplay,
    parameters: m.parameters,
    thrownExceptions: m.thrownExceptions,
    flagsLine: m.flagsLine,
  };
}

function sourceMethodMatches(m: JavapMethodWithName, methodName: string, className: string): boolean {
  if (methodName === '<init>') {
    return m.jvmMethodName === '<init>';
  }
  return m.jvmMethodName === methodName;
}

function provenanceFromJavaSource(p: SourcesJarProvenance | InterprojectProvenance): MethodSignatureProvenance {
  if (p.kind === 'interproject') {
    return {
      kind: 'interprojectSource',
      coordinates: p.coordinates,
      moduleName: p.moduleName,
      moduleRoot: p.moduleRoot,
      absoluteSourcePath: p.absoluteSourcePath,
      sourceRelativePath: p.sourceRelativePath,
    };
  }
  return {
    kind: 'sourcesJar',
    coordinates: p.coordinates,
    jarPath: p.jarPath,
  };
}

export async function getMethodSignatures(
  className: string,
  methodName: string,
  opts: GetMethodSignatureOptions,
): Promise<GetMethodSignatureResult> {
  const mn = methodName.trim();
  if (mn.length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_FQN', message: 'methodName must be non-empty (use <init> for constructors).' },
    };
  }

  const resolved = await resolveWithResolutionCache(opts.projectRoot, {
    forceRefresh: Boolean(opts.forceRefresh),
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        code: 'RESOLUTION_FAILED',
        message: resolved.message,
        stderr: resolved.stderr,
      },
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

  let sourceRead: Awaited<ReturnType<typeof tryReadJavaSourceFromClasspath>>;
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

  if (sourceRead.hit) {
    const meta = parseJavaTypeMetadata(sourceRead.sourceText, className);
    if (meta) {
      const overloads = meta.methods
        .filter((m) => sourceMethodMatches(m, mn, className))
        .map(overloadFromParsedMethod);
      return {
        ok: true,
        className,
        methodName: mn,
        sourceAvailable: true,
        methodFound: overloads.length > 0,
        overloads,
        provenance: provenanceFromJavaSource(sourceRead.provenance),
      };
    }
  }

  const ownerHit = findClasspathOwningClass(resolved.output, {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!ownerHit.ok) {
    return ownerHit;
  }

  const { hit } = ownerHit;
  const provenance: MethodSignatureProvenance =
    hit.kind === 'externalJar'
      ? {
          kind: 'classpathJar',
          coordinates: hit.coordinates,
          jarPath: hit.classpath,
        }
      : {
          kind: 'interprojectBytecode',
          coordinates: hit.coordinates,
          moduleName: hit.moduleName,
          moduleRoot: hit.moduleRoot,
          classpathRoot: hit.classpath,
        };

  const javapClasspath = hit.classpath;

  const javap = await spawnJavapVerbose({
    classpath: javapClasspath,
    className,
  });

  if (!javap.ok) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: javap.message,
        className,
        methodName: mn,
        jarPath: javapClasspath,
        stderr: javap.stderr,
      },
    };
  }

  if (extractClassMemberSection(javap.stdout) === null) {
    return {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: 'Could not locate class member section in javap output',
        className,
        methodName: mn,
        jarPath: javapClasspath,
      },
    };
  }

  const overloads = parseJavapVerboseMethods(javap.stdout, mn, className);

  return {
    ok: true,
    className,
    methodName: mn,
    sourceAvailable: false,
    methodFound: overloads.length > 0,
    overloads,
    provenance,
  };
}
