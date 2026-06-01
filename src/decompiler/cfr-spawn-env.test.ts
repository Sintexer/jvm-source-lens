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

  test('JVMSRC_JAVA_HOME overrides JAVA_HOME in child env', () => {
    const base: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      JAVA_HOME: '/usr/lib/jvm/java-25',
      JVMSRC_JAVA_HOME: '/usr/lib/jvm/java-17',
    };
    const env = buildCfrSpawnEnv(base);
    expect(env['JAVA_HOME']).toBe('/usr/lib/jvm/java-17');
  });

  test('JAVA_HOME is preserved unchanged when JVMSRC_JAVA_HOME is absent', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin', JAVA_HOME: '/usr/lib/jvm/java-25' };
    const env = buildCfrSpawnEnv(base);
    expect(env['JAVA_HOME']).toBe('/usr/lib/jvm/java-25');
  });

  test('JVMSRC_JAVA_HOME whitespace-only is ignored', () => {
    const base: NodeJS.ProcessEnv = { JAVA_HOME: '/usr/lib/jvm/java-25', JVMSRC_JAVA_HOME: '   ' };
    const env = buildCfrSpawnEnv(base);
    expect(env['JAVA_HOME']).toBe('/usr/lib/jvm/java-25');
  });
});
