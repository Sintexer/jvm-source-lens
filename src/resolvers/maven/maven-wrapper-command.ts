import fs from 'node:fs';
import path from 'node:path';

export type MavenWrapperCommand = {
  useWrapper: boolean;
  /** argv prefix: executable (+ `sh` when Unix `mvnw` lacks +x). */
  command: string[];
  /**
   * Set when `mvnw` exists and `.mvn/wrapper/maven-wrapper.jar` is a Git LFS pointer
   * rather than a real JAR. Absent when `maven-wrapper.jar` is absent (`only-script` wrapper).
   */
  lfsPointerJar?: true;
};

function mavenPlatform(): NodeJS.Platform {
  const override = process.env.JVMSRC_TEST_PLATFORM?.trim();
  if (override === 'win32' || override === 'darwin' || override === 'linux') {
    return override;
  }
  return process.platform;
}

function wrapperCandidateNames(): string[] {
  return mavenPlatform() === 'win32' ? ['mvnw.cmd', 'mvnw'] : ['mvnw', 'mvnw.cmd'];
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function wrapperLaunchArgv(wrapperPath: string): string[] {
  if (wrapperPath.endsWith('.cmd') || mavenPlatform() === 'win32') {
    return [wrapperPath];
  }
  if (isExecutable(wrapperPath)) {
    return [wrapperPath];
  }
  return ['sh', wrapperPath];
}

const LFS_POINTER_MAX_SIZE = 512;
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

function isGitLfsPointer(jarPath: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(jarPath);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size > LFS_POINTER_MAX_SIZE) {
    return false;
  }
  try {
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

function resolveSystemMavenExecutable(): string {
  const explicit = process.env.JVMSRC_MAVEN_BIN?.trim();
  if (explicit) {
    return explicit;
  }
  const binName = mavenPlatform() === 'win32' ? 'mvn.cmd' : 'mvn';
  for (const envName of ['MAVEN_HOME', 'M2_HOME']) {
    const home = process.env[envName]?.trim();
    if (home) {
      const candidate = path.join(home, 'bin', binName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return 'mvn';
}

/**
 * Resolves the Maven executable for `projectRoot`: `./mvnw` (`mvnw.cmd` on Windows) when present,
 * unless `JVMSRC_USE_SYSTEM_MAVEN=1` forces system Maven (`JVMSRC_MAVEN_BIN` -> `MAVEN_HOME`/`M2_HOME` -> `mvn` on `PATH`).
 */
export function resolveMavenWrapperCommand(projectRoot: string): MavenWrapperCommand {
  if (process.env.JVMSRC_USE_SYSTEM_MAVEN?.trim() === '1') {
    return { useWrapper: false, command: [resolveSystemMavenExecutable()] };
  }

  const root = path.resolve(projectRoot);

  for (const name of wrapperCandidateNames()) {
    const wrapperPath = path.join(root, name);
    if (fs.existsSync(wrapperPath)) {
      const jarPath = path.join(root, '.mvn', 'wrapper', 'maven-wrapper.jar');
      if (isGitLfsPointer(jarPath)) {
        return { useWrapper: true, command: wrapperLaunchArgv(wrapperPath), lfsPointerJar: true };
      }
      return { useWrapper: true, command: wrapperLaunchArgv(wrapperPath) };
    }
  }

  return { useWrapper: false, command: [resolveSystemMavenExecutable()] };
}
