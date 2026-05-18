import fs from 'node:fs';
import path from 'node:path';

export type JavaBinTool = 'java' | 'javap';

function runtimePlatform(): NodeJS.Platform {
  const override = process.env.JVMSRC_TEST_PLATFORM?.trim();
  if (override === 'win32' || override === 'darwin' || override === 'linux') {
    return override;
  }
  return process.platform;
}

function candidateNames(tool: JavaBinTool): string[] {
  return runtimePlatform() === 'win32' ? [`${tool}.exe`, tool] : [tool];
}

function isRunnable(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  if (runtimePlatform() === 'win32') {
    return true;
  }
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves `java` / `javap` under `JAVA_HOME` when present, else a PATH name for cross-spawn.
 */
export function resolveJavaBinExecutable(tool: JavaBinTool): { ok: true; path: string } {
  const javaHome = process.env.JAVA_HOME?.trim();
  if (javaHome) {
    for (const name of candidateNames(tool)) {
      const candidate = path.join(javaHome, 'bin', name);
      if (isRunnable(candidate)) {
        return { ok: true, path: candidate };
      }
    }
  }
  return { ok: true, path: candidateNames(tool)[0]! };
}
