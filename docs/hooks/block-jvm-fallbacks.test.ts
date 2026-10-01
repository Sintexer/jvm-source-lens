import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const script = path.join(import.meta.dir, 'block-jvm-fallbacks.mjs');

async function run(command: string, env: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn(['node', script], {
    stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command } })),
    stdout: 'pipe',
    env: { ...process.env, ...env },
  });
  return new Response(proc.stdout).text();
}

describe('block-jvm-fallbacks hook', () => {
  test.each([
    'javap -cp lib/foo.jar com.example.Foo',
    'unzip -l ~/lib/foo.jar',
    'jar tf foo.jar',
    'ls ~/.gradle/caches/modules-2/files-2.1',
    'cat ~/.m2/repository/g/a/1/a-1.pom',
    'cd x && javap -p Foo',
  ])('denies %j', async (cmd) => {
    const out = JSON.parse(await run(cmd));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('jvmsrc');
  });

  test.each(['./gradlew build', 'unzip data.zip', 'git status', 'echo jarvis', 'grep -r javapx src'])(
    'allows %j',
    async (cmd) => {
      expect(await run(cmd)).toBe('');
    },
  );

  test('JVMSRC_HOOK_DISABLE=1 turns it off', async () => {
    expect(await run('javap Foo', { JVMSRC_HOOK_DISABLE: '1' })).toBe('');
  });
});
