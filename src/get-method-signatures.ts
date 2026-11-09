import { parseJavaTypeMetadata } from './class-structure/parse-java-type-metadata.js';
import { loadMethodOverloadsViaJavap } from './method-signature-from-javap.js';
import type {
  JavapMethodOverload,
  JavapMethodWithName,
  MethodSignatureProvenance,
} from './class-structure/types.js';
import type {
  ClassSourceError,
  ClassSourceLookupOptions,
  InterprojectProvenance,
  SourcesJarProvenance,
} from './extractor/class-source-types.js';
import { findClasspathOwningClass } from './extractor/find-external-class-jar.js';
import { resolveClassScopeOrError } from './extractor/canonicalize-class-name.js';
import { tryReadJavaSourceFromClasspath } from './extractor/read-java-source-from-classpath.js';
import { enrichIfClassNotFound } from './enrich-class-not-found.js';
import { recordFailureDiagnostic } from './diagnostics/record-failure.js';
import { createSourcesJarResolver } from './sources-jar-resolver.js';
import type { ResolutionOutput } from './resolvers/resolution-output.js';
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

export type GetMethodSignatureResult =
  | GetMethodSignatureSuccess
  | { ok: false; error: ClassSourceError; diagnosticId?: string; hint?: string };

export function methodSignatureFail(
  opts: GetMethodSignatureOptions,
  className: string,
  methodName: string,
  error: ClassSourceError,
  subprocess?: {
    command: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
  },
): GetMethodSignatureResult {
  const d = recordFailureDiagnostic({
    operation: 'get_method_signature',
    publicCode: error.code,
    message: error.message,
    projectRoot: opts.projectRoot,
    buildSystem: 'gradle',
    input: {
      className,
      methodName,
      modulePath: opts.modulePath,
      configuration: opts.configuration,
      includeTest: opts.includeTest,
      forceRefresh: opts.forceRefresh,
    },
    subprocess,
  });
  return { ok: false, error, ...d };
}

function enrichScopeError(
  opts: GetMethodSignatureOptions,
  output: ResolutionOutput,
  error: ClassSourceError,
): ClassSourceError {
  return enrichIfClassNotFound(opts.projectRoot, output, error, {
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
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
    return methodSignatureFail(opts, className, methodName, {
      code: 'INVALID_FQN',
      message: 'methodName must be non-empty (use <init> for constructors).',
    });
  }

  const resolved = await resolveWithResolutionCache(opts.projectRoot, {
    forceRefresh: Boolean(opts.forceRefresh),
    diagnosticOperation: 'get_method_signature',
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        code: 'RESOLUTION_FAILED',
        message: resolved.message,
        stderr: resolved.stderr,
      },
      ...(resolved.diagnosticId !== undefined ? { diagnosticId: resolved.diagnosticId, hint: resolved.hint } : {}),
    };
  }

  const moduleScope = resolveClassScopeOrError(opts.projectRoot, resolved.output, {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!moduleScope.ok) {
    return methodSignatureFail(opts, className, mn, enrichScopeError(opts, resolved.output, moduleScope.error));
  }
  const effectiveModulePath = moduleScope.modulePath;
  className = moduleScope.className;

  const lookupOpts: ClassSourceLookupOptions = {
    className,
    modulePath: effectiveModulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  };

  const resolveSourcesJarFn = createSourcesJarResolver({
    projectRoot: opts.projectRoot,
    operation: 'get_method_signature',
    input: { className, modulePath: opts.modulePath, includeTest: opts.includeTest },
  });

  const sourceRead = await tryReadJavaSourceFromClasspath(resolved.output, {
    ...lookupOpts,
    resolveSourcesJar: resolveSourcesJarFn,
  });

  if (!sourceRead.ok) {
    return methodSignatureFail(opts, className, mn, enrichScopeError(opts, resolved.output, sourceRead.error));
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
    modulePath: effectiveModulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!ownerHit.ok) {
    return methodSignatureFail(opts, className, mn, enrichScopeError(opts, resolved.output, ownerHit.error));
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

  const javap = await loadMethodOverloadsViaJavap({
    classpath: javapClasspath,
    className,
    methodName: mn,
  });
  if (!javap.ok) {
    return methodSignatureFail(opts, className, mn, javap.error);
  }

  const { overloads } = javap;

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
