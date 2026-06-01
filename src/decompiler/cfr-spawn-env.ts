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
 * vectors). If `JVMSRC_JAVA_HOME` is set in the base env it overrides `JAVA_HOME` in the child,
 * letting users point Gradle at a different JDK than the one running jvmsrc (e.g. a project that
 * requires Java 17 while the host JAVA_HOME is Java 25).
 */
export function buildCfrSpawnEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
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
  const jvmsrcJavaHome = base['JVMSRC_JAVA_HOME']?.trim();
  if (jvmsrcJavaHome) {
    env['JAVA_HOME'] = jvmsrcJavaHome;
  }
  return env;
}
