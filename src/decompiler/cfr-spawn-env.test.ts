import { describe, expect, test } from 'bun:test';
import { buildCfrSpawnEnv, CFR_STRIPPED_ENV_KEYS } from './cfr-spawn-env.js';

describe('buildCfrSpawnEnv', () => {
  test('strips JVM injection and classpath override keys', () => {
    const base: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      JAVA_TOOL_OPTIONS: '-javaagent:evil.jar',
      _JAVA_OPTIONS: '-Xmx8g',
      JDK_JAVA_OPTIONS: '--add-opens=java.base/java.lang=ALL-UNNAMED',
      JAVA_OPTIONS: '-verbose',
      CLASSPATH: '/tmp/malicious',
      LD_PRELOAD: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
    };

    const env = buildCfrSpawnEnv(base);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    for (const key of CFR_STRIPPED_ENV_KEYS) {
      expect(env[key]).toBeUndefined();
    }
  });

  test('does not mutate the input env object', () => {
    const base = { PATH: '/bin', JAVA_TOOL_OPTIONS: 'x' };
    buildCfrSpawnEnv(base);
    expect(base.JAVA_TOOL_OPTIONS).toBe('x');
  });
});
