import {
  detectRequiredJavaVersion,
  readGradleWrapperMaxJava,
  type JavaVersionHint,
} from './detect-required-version.js';
import { findJdk, findJdkInRange, jdkSearchLocations } from './find-jdk.js';
import { readJdkReleaseFile } from './read-jdk-release-file.js';

/**
 * A successfully resolved JDK to use for a project.
 */
export interface ResolvedJdk {
  ok: true;
  /**
   * Absolute path to the JDK home directory. Set this as `JAVA_HOME` in the child
   * process environment when spawning Gradle.
   *
   * An empty string means "do not override JAVA_HOME" — Gradle will use whatever JDK
   * it finds on the PATH or via its own discovery.
   */
  jdkHome: string;
  /** Full version string from the `release` file, e.g. "17.0.11". */
  fullVersion: string;
  /** Java major version (0 = unknown). */
  majorVersion: number;
  /** The hint that led to this selection. */
  hint: JavaVersionHint;
}

/**
 * Indicates that no suitable JDK was found locally.
 *
 * The `message` field contains a human-readable, actionable error ready to display
 * to the user. It explicitly states that re-running the tool without fixing the
 * environment will produce the same result.
 */
export interface JdkNotFound {
  ok: false;
  message: string;
}

export type JdkResolutionResult = ResolvedJdk | JdkNotFound;

/**
 * Resolves the JDK to use for a given project.
 *
 * ## Hint semantics
 *
 * | Source                   | Interpretation | Override rule                                    |
 * |--------------------------|----------------|--------------------------------------------------|
 * | `JVMSRC_JAVA_HOME`       | Explicit path  | Always use                                       |
 * | `gradle-properties-home` | Explicit path  | Always use                                       |
 * | `sdkmanrc`               | Exact version  | Override if current JDK major ≠ required         |
 * | `java-version-file`      | Exact version  | Override if current JDK major ≠ required         |
 * | `toolchain-script`       | Exact version  | Override if current JDK major ≠ required         |
 * | `cached-toolchain`       | Exact version  | Override if current JDK major ≠ required         |
 * | `gradle-wrapper-inferred`| Min + max-safe | Override when current JDK is outside safe range  |
 * | `none`                   | No hint        | Pass through current JAVA_HOME unchanged         |
 *
 * The `gradle-wrapper-inferred` source is treated as a compatibility range:
 * - lower bound: minimum Java required by that Gradle wrapper version;
 * - upper bound: conservative max Java major known to work for that wrapper family.
 *
 * This avoids running old Gradle wrappers on very new JDKs (for example Gradle 7.x on
 * Java 25), which can fail during init script compilation before the project is evaluated.
 *
 * Within that range, we still prefer the current JAVA_HOME when it already fits.
 *
 * Exact-version sources (`sdkmanrc`, `.java-version`, toolchain) represent an intentional
 * choice by the project team — typically to avoid breakage in a newer JDK. If the current
 * JDK already matches (same major), no override is needed.
 *
 * @param projectRoot            - Absolute path to the Gradle project root.
 * @param cachedToolchainVersion - Optional: `javaToolchainVersion` from a previous cached
 *                                 `ResolutionOutput`. Used as a lower-priority version hint.
 * @param env                    - Environment to read vars from. Defaults to `process.env`.
 */
export function resolveJdkForProject(
  projectRoot: string,
  cachedToolchainVersion?: number,
  env: NodeJS.ProcessEnv = process.env,
  ctx?: { homeDir?: string; platform?: NodeJS.Platform },
): JdkResolutionResult {
  const hint = detectRequiredJavaVersion(projectRoot, { env, cachedToolchainVersion });

  // ── Explicit path overrides ──────────────────────────────────────────────
  // JVMSRC_JAVA_HOME and org.gradle.java.home are direct JDK paths — always use them.
  if (hint.source === 'jvmsrc-java-home' || hint.source === 'gradle-properties-home') {
    return resolveExplicitPath(hint.path, hint);
  }

  // ── No hint ──────────────────────────────────────────────────────────────
  if (hint.source === 'none') {
    return passThroughCurrentJdk(env, hint);
  }

  // ── Version hints ────────────────────────────────────────────────────────
  const required = hint.majorVersion;
  const currentMajor = readCurrentJdkMajor(env);

  if (hint.source === 'gradle-wrapper-inferred') {
    // Wrapper-inferred compatibility range:
    // - below minimum: pick a newer installed JDK;
    // - above conservative max: pick an older compatible installed JDK.
    if (currentMajor !== null && currentMajor >= required) {
      const wrapperMax = readGradleWrapperMaxJava(projectRoot);
      if (wrapperMax === null || currentMajor <= wrapperMax) {
        return passThroughCurrentJdk(env, hint);
      }

      const capped = findJdkInRange(required, wrapperMax, env, ctx);
      if (capped) {
        return {
          ok: true,
          jdkHome: capped.jdkHome,
          fullVersion: capped.fullVersion,
          majorVersion: capped.majorVersion,
          hint,
        };
      }

      return jdkRangeNotFoundError(required, wrapperMax, hint);
    }
    // Current JDK is too old → find one that meets the minimum.
    return findAndOverride(required, hint, env, ctx);
  }

  // Exact-version hint (sdkmanrc, .java-version, toolchain, cached-toolchain):
  // Override only when the current JDK major doesn't already match.
  if (currentMajor !== null && currentMajor === required) {
    return passThroughCurrentJdk(env, hint);
  }

  return findAndOverride(required, hint, env, ctx);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the major version of the JDK pointed at by `JAVA_HOME`, or null if
 * `JAVA_HOME` is unset, doesn't exist, or has no readable `release` file.
 */
function readCurrentJdkMajor(env: NodeJS.ProcessEnv): number | null {
  const javaHome = env['JAVA_HOME']?.trim();
  if (!javaHome) {
    return null;
  }
  const release = readJdkReleaseFile(javaHome);
  return release ? release.majorVersion : null;
}

function passThroughCurrentJdk(env: NodeJS.ProcessEnv, hint: JavaVersionHint): ResolvedJdk {
  const javaHome = env['JAVA_HOME']?.trim() ?? '';
  const release = javaHome ? readJdkReleaseFile(javaHome) : null;
  return {
    ok: true,
    jdkHome: javaHome,
    fullVersion: release?.fullVersion ?? 'unknown',
    majorVersion: release?.majorVersion ?? 0,
    hint,
  };
}

function findAndOverride(
  required: number,
  hint: JavaVersionHint,
  env: NodeJS.ProcessEnv,
  ctx?: { homeDir?: string; platform?: NodeJS.Platform },
): JdkResolutionResult {
  const found = findJdk(required, env, ctx);
  if (found) {
    return {
      ok: true,
      jdkHome: found.jdkHome,
      fullVersion: found.fullVersion,
      majorVersion: found.majorVersion,
      hint,
    };
  }
  return jdkNotFoundError(required, hint);
}

function jdkRangeNotFoundError(
  requiredMinMajor: number,
  requiredMaxMajor: number,
  hint: JavaVersionHint,
): JdkNotFound {
  const sourceDesc = describeHintSource(hint);
  const locations = jdkSearchLocations();

  return {
    ok: false,
    message: [
      `No Gradle-compatible JDK found on this machine.`,
      ``,
      `Required Java range: ${requiredMinMajor}..${requiredMaxMajor} (detected from ${sourceDesc})`,
      ``,
      `Locations searched:`,
      ...locations.map((l) => `  • ${l}`),
      ``,
      `How to fix — choose one option:`,
      `  1. Install a JDK in the required range (for example Java ${requiredMaxMajor}):`,
      `       sdk install java ${requiredMaxMajor}-tem          (SDKMan)`,
      `       brew install openjdk@${requiredMaxMajor}           (Homebrew, macOS)`,
      `       apt-get install openjdk-${requiredMaxMajor}-jdk    (Debian/Ubuntu)`,
      ``,
      `  2. Set JVMSRC_JAVA_HOME to a compatible installation:`,
      `       export JVMSRC_JAVA_HOME=/path/to/jdk-${requiredMaxMajor}`,
      ``,
      `  2b. Add a global JDK roots directory (contains multiple JDK subfolders):`,
      `       jvmsrc config jdk-roots add /path/to/jdks`,
      ``,
      `  3. Set org.gradle.java.home in the project's gradle.properties:`,
      `       org.gradle.java.home=/path/to/jdk-${requiredMaxMajor}`,
      ``,
      `Further operations for this project will fail until a compatible JDK is discoverable.`,
      ``,
      `Re-running this tool without selecting a compatible JDK will produce the same error.`,
    ].join('\n'),
  };
}

function resolveExplicitPath(jdkPath: string, hint: JavaVersionHint): JdkResolutionResult {
  const release = readJdkReleaseFile(jdkPath);
  if (!release) {
    return {
      ok: false,
      message: buildExplicitPathError(jdkPath, hint),
    };
  }
  return {
    ok: true,
    jdkHome: jdkPath,
    fullVersion: release.fullVersion,
    majorVersion: release.majorVersion,
    hint,
  };
}

function buildExplicitPathError(jdkPath: string, hint: JavaVersionHint): string {
  const source =
    hint.source === 'jvmsrc-java-home'
      ? 'the JVMSRC_JAVA_HOME environment variable'
      : 'org.gradle.java.home in gradle.properties';

  return [
    `JDK not found at the path specified by ${source}:`,
    `  ${jdkPath}`,
    ``,
    `The directory either does not exist or is not a valid JDK (no "release" file found).`,
    ``,
    `How to fix:`,
    `  • Correct the path in ${source}`,
    `  • Or install a JDK at that location`,
    ``,
    `Re-running this tool without fixing the path will produce the same error.`,
  ].join('\n');
}

function jdkNotFoundError(requiredMajor: number, hint: JavaVersionHint): JdkNotFound {
  const sourceDesc = describeHintSource(hint);
  const locations = jdkSearchLocations();

  return {
    ok: false,
    message: [
      `No Java ${requiredMajor} JDK found on this machine.`,
      ``,
      `Required Java version: ${requiredMajor} (detected from ${sourceDesc})`,
      ``,
      `Locations searched:`,
      ...locations.map((l) => `  • ${l}`),
      ``,
      `How to fix — choose one option:`,
      `  1. Install Java ${requiredMajor} via your preferred package manager:`,
      `       sdk install java ${requiredMajor}-tem          (SDKMan)`,
      `       brew install openjdk@${requiredMajor}           (Homebrew, macOS)`,
      `       apt-get install openjdk-${requiredMajor}-jdk    (Debian/Ubuntu)`,
      ``,
      `  2. Set JVMSRC_JAVA_HOME to an existing Java ${requiredMajor} installation:`,
      `       export JVMSRC_JAVA_HOME=/path/to/jdk-${requiredMajor}`,
      ``,
      `  2b. Add a global JDK roots directory (contains multiple JDK subfolders):`,
      `       jvmsrc config jdk-roots add /path/to/jdks`,
      ``,
      `  3. Set org.gradle.java.home in the project's gradle.properties:`,
      `       org.gradle.java.home=/path/to/jdk-${requiredMajor}`,
      ``,
      `Further operations for this project will fail until a compatible JDK is discoverable.`,
      ``,
      `Re-running this tool without installing a matching JDK or`,
      `configuring JVMSRC_JAVA_HOME will produce the same error.`,
    ].join('\n'),
  };
}

function describeHintSource(hint: JavaVersionHint): string {
  switch (hint.source) {
    case 'sdkmanrc':
      return '.sdkmanrc';
    case 'java-version-file':
      return '.java-version';
    case 'toolchain-script':
      return 'JavaLanguageVersion.of() in build script';
    case 'gradle-wrapper-inferred':
      return 'Gradle wrapper version (minimum Java inferred)';
    case 'cached-toolchain':
      return 'previously resolved Gradle toolchain version';
    default:
      return hint.source;
  }
}
