import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mavenArgsRepoLocalArg } from '../../../src/resolvers/maven/cache-inputs.js';

/** Runs the Maven wrapper from `wrapperRoot` with `cwd = projectDir`. Inherits env (incl. `MAVEN_ARGS`). */
export async function runMvnwFrom(wrapperRoot: string, projectDir: string, ...args: string[]): Promise<void> {
  const mvnw = path.join(wrapperRoot, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  // Maven 3.9 ignores `maven.repo.local` passed through `MAVEN_ARGS`, so pass it explicitly too.
  const repoArg = mavenArgsRepoLocalArg(projectDir);
  const proc = Bun.spawn([mvnw, '-B', '-q', ...(repoArg ? [repoArg] : []), ...args], {
    cwd: projectDir,
    env: { ...process.env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Maven ${args.join(' ')} in ${path.basename(projectDir)} exited with ${code}`);
  }
}

/** Runs the project's own Maven wrapper. */
export function runMvnw(projectDir: string, ...args: string[]): Promise<void> {
  return runMvnwFrom(projectDir, projectDir, ...args);
}

export type TempLocalRepo = {
  /** Absolute path of the temp Maven local repository. */
  readonly dir: string;
  /** Removes one group directory (for example `com/example/mvnsnap`) so Maven must download it again. */
  clearGroup(groupPath: string): void;
  /** Restores `MAVEN_ARGS` and deletes the temp repository. */
  dispose(): void;
};

/**
 * Creates a temp Maven local repository and points Maven at it through `MAVEN_ARGS`.
 * Scenario tests use it so they never read or delete anything in the real `~/.m2`.
 */
export function createTempLocalRepo(prefix: string): TempLocalRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-m2-`));
  const prevArgs = process.env.MAVEN_ARGS;
  process.env.MAVEN_ARGS = [prevArgs, `-Dmaven.repo.local=${dir}`].filter(Boolean).join(' ');
  return {
    dir,
    clearGroup(groupPath: string): void {
      const target = path.resolve(dir, groupPath);
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to delete outside the temp local repo: ${target}`);
      }
      fs.rmSync(target, { recursive: true, force: true });
    },
    dispose(): void {
      if (prevArgs === undefined) {
        delete process.env.MAVEN_ARGS;
      } else {
        process.env.MAVEN_ARGS = prevArgs;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
