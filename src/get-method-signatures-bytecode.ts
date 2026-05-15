import type {
  MethodSignatureProvenance,
} from './class-structure/types.js';
import type { ClassSourceLookupOptions } from './extractor/class-source-types.js';
import { findClasspathOwningClass } from './extractor/find-external-class-jar.js';
import {
  methodSignatureFail,
  type GetMethodSignatureOptions,
  type GetMethodSignatureResult,
} from './get-method-signatures.js';
import { loadMethodOverloadsViaJavap } from './method-signature-from-javap.js';
import { resolveWithResolutionCache } from './resolve-with-cache.js';

/**
 * Like {@link getMethodSignatures} but **only** `javap -private -verbose` on a classpath that contains
 * the `.class` — no sources JAR / `src/` fallback (see README §7.2, ROADMAP inspection split).
 */
export async function getMethodSignaturesBytecode(
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
    diagnosticOperation: 'get_method_signature_bytecode',
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

  const lookupOpts: ClassSourceLookupOptions = {
    className,
    modulePath: opts.modulePath,
    configuration: opts.configuration,
    includeTest: opts.includeTest,
  };

  const ownerHit = findClasspathOwningClass(resolved.output, lookupOpts);
  if (!ownerHit.ok) {
    return methodSignatureFail(opts, className, mn, ownerHit.error);
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

  const javap = await loadMethodOverloadsViaJavap({
    classpath: hit.classpath,
    className,
    methodName: mn,
  });
  if (!javap.ok) {
    return methodSignatureFail(opts, className, mn, javap.error);
  }

  return {
    ok: true,
    className,
    methodName: mn,
    sourceAvailable: false,
    methodFound: javap.overloads.length > 0,
    overloads: javap.overloads,
    provenance,
  };
}
