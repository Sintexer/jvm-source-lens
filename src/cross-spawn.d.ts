declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process';

  function spawn(
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ): ChildProcess;

  export default spawn;
}
