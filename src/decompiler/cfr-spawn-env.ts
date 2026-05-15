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

/** Builds a minimal env for CFR subprocesses (PATH, JAVA_HOME, LANG, etc. minus injection vectors). */
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
  return env;
}
