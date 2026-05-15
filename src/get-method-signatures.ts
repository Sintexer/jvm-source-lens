import { extractClassMemberSection, parseJavapVerboseMethods } from './class-structure/javap-parse.js';
import { spawnJavapVerbose } from './class-structure/spawn-javap.js';
import type { JavapMethodOverload, MethodSignatureProvenance } from './class-structure/types.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import { findExternalJarOwningClass } from './extractor/find-external-class-jar.js';
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
  /** javap reads bytecode metadata — same rationale as CFR-derived artifacts (README §7.1). */
  sourceAvailable: false;
  methodFound: boolean;
  overloads: JavapMethodOverload[];
  provenance: MethodSignatureProvenance;
};

export type GetMethodSignatureResult = GetMethodSignatureSuccess | { ok: false; error: ClassSourceError };

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

  const jarHit = findExternalJarOwningClass(resolved.output, {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  });
  if (!jarHit.ok) {
    return jarHit;
  }

  const { hit } = jarHit;
  const provenance: MethodSignatureProvenance = {
    kind: 'classpathJar',
    coordinates: hit.coordinates,
    jarPath: hit.jarPath,
  };

  const javap = await spawnJavapVerbose({
    jarPath: hit.jarPath,
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
        jarPath: hit.jarPath,
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
        jarPath: hit.jarPath,
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
