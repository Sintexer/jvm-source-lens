import fs from 'node:fs';
import path from 'node:path';

export type GradleWrapperCommand = {
  useWrapper: boolean;
  /** argv prefix: executable + fixed args before Gradle flags (-P, --init-script, task). */
  command: string[];
  /**
   * Set when a `gradlew` script exists but `gradle/wrapper/gradle-wrapper.jar` is a
   * Git LFS pointer rather than a real JAR. The caller should surface an actionable error
   * instead of spawning the wrapper (which would fail with ClassNotFoundException).
   */
  lfsPointerJar?: true;
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

/** Maximum file size (bytes) that could be a Git LFS pointer — real JARs are at least 1 KB. */
const LFS_POINTER_MAX_SIZE = 512;
/** Git LFS pointer magic prefix (UTF-8). */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

/**
 * Returns true when the file at `jarPath` looks like a Git LFS pointer rather than a real JAR.
 * A Git LFS pointer is a small text file whose first line is
 * `version https://git-lfs.github.com/spec/v1`. Real JARs start with the ZIP magic `PK\x03\x04`.
 */
function isGitLfsPointer(jarPath: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(jarPath);
  } catch {
    return false; // missing — not our concern here
  }
  if (!stat.isFile() || stat.size > LFS_POINTER_MAX_SIZE) {
    return false;
  }
  try {
    // Read only the first ~48 bytes — enough to identify the LFS magic prefix.
    const fd = fs.openSync(jarPath, 'r');
    const buf = Buffer.alloc(LFS_POINTER_PREFIX.length);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (bytesRead < LFS_POINTER_PREFIX.length) {
      return false;
    }
    return buf.toString('utf8') === LFS_POINTER_PREFIX;
  } catch {
    return false;
  }
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
      const jarPath = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar');
      if (isGitLfsPointer(jarPath)) {
        return { useWrapper: true, command: wrapperLaunchArgv(wrapperPath), lfsPointerJar: true };
      }
      return { useWrapper: true, command: wrapperLaunchArgv(wrapperPath) };
    }
  }

  return { useWrapper: false, command: ['gradle'] };
}
