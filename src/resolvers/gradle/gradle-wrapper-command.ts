import fs from 'node:fs';
import path from 'node:path';

export type GradleWrapperCommand = {
  useWrapper: boolean;
  /** argv prefix: executable + fixed args before Gradle flags (-P, --init-script, task). */
  command: string[];
};

function gradlePlatform(): NodeJS.Platform {
  const override = process.env.JVMSRC_TEST_PLATFORM?.trim();
  if (override === 'win32' || override === 'darwin' || override === 'linux') {
    return override;
  }
  return process.platform;
}

/** Wrapper script names in preference order for the current OS. */
function wrapperCandidateNames(): string[] {
  return gradlePlatform() === 'win32' ? ['gradlew.bat', 'gradlew'] : ['gradlew', 'gradlew.bat'];
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * argv prefix to run a Gradle wrapper script. Uses POSIX `sh` only when the Unix script
 * exists but is not executable (e.g. checkout without +x). `.bat` launch is handled by
 * {@link spawnChild} via `cross-spawn` on Node.
 */
function wrapperLaunchArgv(wrapperPath: string): string[] {
  if (wrapperPath.endsWith('.bat') || gradlePlatform() === 'win32') {
    return [wrapperPath];
  }
  if (isExecutable(wrapperPath)) {
    return [wrapperPath];
  }
  return ['sh', wrapperPath];
}

/**
 * Which Gradle executable to run for a project root: wrapper script or `gradle` on PATH.
 * Does not embed platform shell commands (`cmd.exe`, etc.) — spawn layer uses cross-spawn.
 */
export function resolveGradleWrapperCommand(projectRoot: string): GradleWrapperCommand {
  const root = path.resolve(projectRoot);

  for (const name of wrapperCandidateNames()) {
    const wrapperPath = path.join(root, name);
    if (fs.existsSync(wrapperPath)) {
      return { useWrapper: true, command: wrapperLaunchArgv(wrapperPath) };
    }
  }

  return { useWrapper: false, command: ['gradle'] };
}
