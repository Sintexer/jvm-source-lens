import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * The source that provided the Java version hint, in priority order.
 *
 * - `jvmsrc-java-home`         – `JVMSRC_JAVA_HOME` env var set; skip all other detection.
 * - `gradle-properties-home`   – `org.gradle.java.home` in gradle.properties (absolute JDK path).
 * - `sdkmanrc`                 – `.sdkmanrc` in project root (`java=17.0.9-tem`).
 * - `java-version-file`        – `.java-version` in project root (`17` or `temurin-17`).
 * - `toolchain-script`         – `JavaLanguageVersion.of(N)` found in build script (best-effort regex).
 * - `gradle-wrapper-inferred`  – minimum Java inferred from the Gradle wrapper distribution version.
 * - `cached-toolchain`         – `javaToolchainVersion` stored in a previous successful resolution.
 * - `none`                     – no hint found; caller should pass through current `JAVA_HOME`.
 */
export type JavaVersionHintSource =
  | 'jvmsrc-java-home'
  | 'gradle-properties-home'
  | 'sdkmanrc'
  | 'java-version-file'
  | 'toolchain-script'
  | 'gradle-wrapper-inferred'
  | 'cached-toolchain';

export type JavaVersionHint =
  /** `JVMSRC_JAVA_HOME` is set — use it directly, skip all local search. */
  | { source: 'jvmsrc-java-home'; path: string }
  /** `org.gradle.java.home` in gradle.properties — an absolute JDK path. */
  | { source: 'gradle-properties-home'; path: string }
  /** A major version was detected from a project file or inferred from the wrapper. */
  | { source: Exclude<JavaVersionHintSource, 'jvmsrc-java-home' | 'gradle-properties-home'>; majorVersion: number }
  /** No hint available. */
  | { source: 'none' };

// ---------------------------------------------------------------------------
// Gradle version → minimum compatible Java major version
// https://docs.gradle.org/current/userguide/compatibility.html
// ---------------------------------------------------------------------------
const GRADLE_MIN_JAVA: Array<{ gradleMajor: number; gradleMinor?: number; minJava: number }> = [
  { gradleMajor: 9, minJava: 17 },
  { gradleMajor: 8, gradleMinor: 8, minJava: 17 },
  { gradleMajor: 8, minJava: 8 },
  { gradleMajor: 7, minJava: 8 },
];

/**
 * Returns the minimum Java major version required by a given Gradle version string.
 * Falls back to 8 when the version cannot be parsed.
 */
export function gradleVersionToMinJava(gradleVersion: string): number {
  const parts = gradleVersion.split('.').map((p) => parseInt(p, 10));
  const major = parts[0];
  const minor = parts[1] ?? 0;
  if (!Number.isInteger(major)) {
    return 8;
  }
  for (const entry of GRADLE_MIN_JAVA) {
    if (major === entry.gradleMajor) {
      if (entry.gradleMinor === undefined) {
        return entry.minJava;
      }
      if (minor >= entry.gradleMinor) {
        return entry.minJava;
      }
    }
  }
  return 8;
}

// ---------------------------------------------------------------------------
// Individual readers (all synchronous, no subprocess)
// ---------------------------------------------------------------------------

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Reads `gradle.properties` and returns:
 *   - `{ kind: 'path', value }` if `org.gradle.java.home` is set
 *   - `{ kind: 'version', value }` if a java version can be extracted from `org.gradle.jvmargs`
 *   - `null` if neither is present
 */
export function readGradleProperties(
  projectRoot: string,
): { kind: 'path'; value: string } | { kind: 'version'; value: number } | null {
  const text = readFileSafe(path.join(projectRoot, 'gradle.properties'));
  if (!text) {
    return null;
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();

    if (key === 'org.gradle.java.home' && value.length > 0) {
      // Resolve ~ in the path
      const resolved = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
      return { kind: 'path', value: resolved };
    }

    if (key === 'org.gradle.jvmargs') {
      // e.g. --release 17  or  -source 17  or  -target 17
      const releaseMatch = value.match(/--release\s+(\d+)/);
      if (releaseMatch && releaseMatch[1]) {
        return { kind: 'version', value: parseInt(releaseMatch[1], 10) };
      }
    }
  }
  return null;
}

/**
 * Reads `.sdkmanrc` for a `java=<version>` entry and extracts the major version.
 * Returns null if the file is absent or contains no parseable Java entry.
 *
 * Supported formats:
 *   java=17.0.9-tem       → 17
 *   java=21.0.1-graalce   → 21
 *   java=8.0.392-amzn     → 8
 *   java=1.8.0_392-...    → 8  (legacy)
 */
export function readSdkmanrc(projectRoot: string): number | null {
  const text = readFileSafe(path.join(projectRoot, '.sdkmanrc'));
  if (!text) {
    return null;
  }
  const match = text.match(/^\s*java\s*=\s*([^\s#]+)/m);
  if (!match || !match[1]) {
    return null;
  }
  return parseSdkmanJavaVersion(match[1]);
}

/**
 * Parses a SDKMan java version identifier into a major version number.
 * Exported for unit testing.
 *
 * Formats encountered in the wild:
 *   "17.0.9-tem"    → 17
 *   "21-open"       → 21
 *   "1.8.0_392-..." → 8
 *   "8.0.392-amzn"  → 8
 */
export function parseSdkmanJavaVersion(raw: string): number | null {
  // Strip distribution suffix: everything after the last `-` that is alphabetic
  const withoutDist = raw.replace(/-[a-z][a-z0-9]*$/i, '');
  // Now parse first numeric segment
  const parts = withoutDist.split('.');
  const firstPart = parts[0];
  if (!firstPart) {
    return null;
  }
  const first = parseInt(firstPart, 10);
  if (!Number.isInteger(first) || first < 0) {
    return null;
  }
  // Legacy 1.x
  if (first === 1 && parts.length >= 2) {
    const secondPart = parts[1];
    if (secondPart) {
      const second = parseInt(secondPart, 10);
      if (Number.isInteger(second) && second > 0) {
        return second;
      }
    }
  }
  return first || null;
}

/**
 * Reads `.java-version` (jenv / asdf style) and returns the major version.
 *
 * Supported formats:
 *   "17"               → 17
 *   "17.0.11"          → 17
 *   "temurin-17.0.11"  → 17
 *   "openjdk64-17.0.9" → 17
 *   "1.8"              → 8  (legacy)
 */
export function readJavaVersionFile(projectRoot: string): number | null {
  const text = readFileSafe(path.join(projectRoot, '.java-version'));
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const line = trimmed.split('\n')[0];
  if (!line) {
    return null;
  }
  // Strip any prefix like "temurin-", "openjdk64-", etc.
  const numeric = line.trim().replace(/^[a-z][a-z0-9_-]*-/i, '');
  const parts = numeric.split('.');
  const firstPart = parts[0];
  if (!firstPart) {
    return null;
  }
  const first = parseInt(firstPart, 10);
  if (!Number.isInteger(first) || first < 0) {
    return null;
  }
  if (first === 1 && parts.length >= 2) {
    const secondPart = parts[1];
    if (secondPart) {
      const second = parseInt(secondPart, 10);
      if (Number.isInteger(second) && second > 0) {
        return second;
      }
    }
  }
  return first || null;
}

/**
 * Scans `build.gradle` and `build.gradle.kts` for `JavaLanguageVersion.of(N)` declarations.
 * Returns the first matched major version, or null if none found.
 *
 * This is a best-effort regex scan — not a full Groovy/Kotlin AST parse.
 */
export function readToolchainFromBuildScript(projectRoot: string): number | null {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    const text = readFileSafe(path.join(projectRoot, name));
    if (!text) {
      continue;
    }
    // Matches: JavaLanguageVersion.of(17)  or  JavaLanguageVersion.of( 21 )
    const match = text.match(/JavaLanguageVersion\.of\(\s*(\d+)\s*\)/);
    if (match && match[1]) {
      const version = parseInt(match[1], 10);
      if (Number.isInteger(version) && version > 0) {
        return version;
      }
    }
  }
  return null;
}

/**
 * Infers the minimum required Java version from the Gradle wrapper distribution URL.
 *
 * Reads `gradle/wrapper/gradle-wrapper.properties` and extracts the Gradle version
 * from `distributionUrl`, then maps it to the minimum Java version.
 */
export function readGradleWrapperMinJava(projectRoot: string): number | null {
  const text = readFileSafe(
    path.join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
  );
  if (!text) {
    return null;
  }
  // distributionUrl=https\://services.gradle.org/distributions/gradle-8.8-bin.zip
  const match = text.match(/distributionUrl\s*=\s*.*gradle-(\d+\.\d+(?:\.\d+)?)/);
  if (!match || !match[1]) {
    return null;
  }
  return gradleVersionToMinJava(match[1]);
}

// ---------------------------------------------------------------------------
// Main detection entry point
// ---------------------------------------------------------------------------

/**
 * Detects the Java version required by the project at `projectRoot` by reading
 * project files in priority order. No subprocess is spawned.
 *
 * Priority:
 *   1. `JVMSRC_JAVA_HOME` env var (caller passes `env`)
 *   2. `gradle.properties` → `org.gradle.java.home` (absolute JDK path)
 *   3. `gradle.properties` → `org.gradle.jvmargs` version flag
 *   4. `.sdkmanrc` `java=` entry
 *   5. `.java-version` file
 *   6. `build.gradle[.kts]` `JavaLanguageVersion.of(N)` declaration
 *   7. Gradle wrapper distribution version → minimum Java
 *   8. `cachedToolchainVersion` from a previous successful resolution
 *   9. `{ source: 'none' }` — no information available
 */
export function detectRequiredJavaVersion(
  projectRoot: string,
  opts: {
    /** Pass `process.env` or a subset; allows easy injection in tests. */
    env?: NodeJS.ProcessEnv;
    /** `javaToolchainVersion` from a previously cached `ResolutionOutput`. */
    cachedToolchainVersion?: number;
  } = {},
): JavaVersionHint {
  const env = opts.env ?? process.env;

  // 1. Explicit override — skip everything else
  const jvmsrcJavaHome = env['JVMSRC_JAVA_HOME']?.trim();
  if (jvmsrcJavaHome) {
    return { source: 'jvmsrc-java-home', path: jvmsrcJavaHome };
  }

  // 2 & 3. gradle.properties
  const gradleProp = readGradleProperties(projectRoot);
  if (gradleProp) {
    if (gradleProp.kind === 'path') {
      return { source: 'gradle-properties-home', path: gradleProp.value };
    }
    return { source: 'toolchain-script', majorVersion: gradleProp.value };
  }

  // 4. .sdkmanrc
  const sdkman = readSdkmanrc(projectRoot);
  if (sdkman !== null) {
    return { source: 'sdkmanrc', majorVersion: sdkman };
  }

  // 5. .java-version
  const javaVersionFile = readJavaVersionFile(projectRoot);
  if (javaVersionFile !== null) {
    return { source: 'java-version-file', majorVersion: javaVersionFile };
  }

  // 6. Build script toolchain declaration
  const toolchain = readToolchainFromBuildScript(projectRoot);
  if (toolchain !== null) {
    return { source: 'toolchain-script', majorVersion: toolchain };
  }

  // 7. Gradle wrapper inferred minimum
  const wrapperMin = readGradleWrapperMinJava(projectRoot);
  if (wrapperMin !== null) {
    return { source: 'gradle-wrapper-inferred', majorVersion: wrapperMin };
  }

  // 8. Cached toolchain from a previous successful Gradle run
  if (opts.cachedToolchainVersion !== undefined && opts.cachedToolchainVersion > 0) {
    return { source: 'cached-toolchain', majorVersion: opts.cachedToolchainVersion };
  }

  return { source: 'none' };
}
