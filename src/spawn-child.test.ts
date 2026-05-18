import { afterEach, describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { readProcessStreamToText, spawnChild } from './spawn-child.js';

describe('spawnChild', () => {
  let savedForceNode: string | undefined;

  afterEach(() => {
    if (savedForceNode === undefined) {
      delete process.env.JVMSRC_TEST_FORCE_NODE_SPAWN;
    } else {
      process.env.JVMSRC_TEST_FORCE_NODE_SPAWN = savedForceNode;
    }
  });

  test('node child_process path captures stdout', async () => {
    savedForceNode = process.env.JVMSRC_TEST_FORCE_NODE_SPAWN;
    process.env.JVMSRC_TEST_FORCE_NODE_SPAWN = '1';

    const proc = spawnChild(process.platform === 'win32' ? ['cmd', '/c', 'echo hi'] : ['echo', 'hi'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([
      readProcessStreamToText(proc.stdout),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('hi');
  });

  test('node path rejects exited when spawn fails (ENOENT)', async () => {
    savedForceNode = process.env.JVMSRC_TEST_FORCE_NODE_SPAWN;
    process.env.JVMSRC_TEST_FORCE_NODE_SPAWN = '1';

    const missing = path.join(os.tmpdir(), `jvmsrc-missing-${process.pid}`);
    const proc = spawnChild([missing], { stdout: 'pipe', stderr: 'pipe' });
    await expect(proc.exited).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
