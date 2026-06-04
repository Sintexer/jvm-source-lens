/**
 * Environment keys stripped before spawning Java/CFR.
 * Prevents agent-injected JVM flags (e.g. `-javaagent`) via the parent process env.
 */
export const CFR_STRIPPED_ENV_KEYS = [
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'JAVA_OPTIONS',
  'CLASSPATH',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
] as const;

export type CfrStrippedEnvKey = (typeof CFR_STRIPPED_ENV_KEYS)[number];

/**
 * Builds a minimal env for Gradle/CFR subprocesses (PATH, JAVA_HOME, LANG, etc. minus injection
 * vectors).
 *
 * JAVA_HOME resolution priority (highest → lowest):
 *   1. `resolvedJavaHome` parameter — set by the JDK resolver after scanning the machine.
 *   2. `JVMSRC_JAVA_HOME` env var   — explicit user override (also consumed by the resolver,
 *      but kept here as a safety net for callers that bypass resolution).
 *   3. `JAVA_HOME` from the base env — passed through unchanged when neither override is set.
 *
 * An empty string for `resolvedJavaHome` means "no override" (resolver found no hint and there
 * is no JAVA_HOME to use as default), which leaves JAVA_HOME absent from the child env so
 * Gradle falls back to its own JVM discovery.
 */
export function buildCfrSpawnEnv(
  base: NodeJS.ProcessEnv = process.env,
  resolvedJavaHome?: string,
): Record<string, string> {
  const stripped = new Set<string>(CFR_STRIPPED_ENV_KEYS);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) {
      continue;
    }
    if (stripped.has(key)) {
      continue;
    }
    env[key] = value;
  }

  // Priority 1: resolved JDK path from the JDK resolver
  if (resolvedJavaHome && resolvedJavaHome.length > 0) {
    env['JAVA_HOME'] = resolvedJavaHome;
    return env;
  }

  // Priority 2: explicit user env override (safety net)
  const jvmsrcJavaHome = base['JVMSRC_JAVA_HOME']?.trim();
  if (jvmsrcJavaHome) {
    env['JAVA_HOME'] = jvmsrcJavaHome;
  }

  return env;
}
