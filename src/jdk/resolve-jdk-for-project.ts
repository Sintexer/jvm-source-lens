import { detectRequiredJavaVersion, type JavaVersionHint } from './detect-required-version.js';
import { findJdk, jdkSearchLocations } from './find-jdk.js';
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
 * | `gradle-wrapper-inferred`| **Minimum**    | Override only if current JDK major < minimum     |
 * | `none`                   | No hint        | Pass through current JAVA_HOME unchanged         |
 *
 * The `gradle-wrapper-inferred` source is treated as a *minimum* because the Gradle
 * wrapper version only tells us the lowest JDK that can run Gradle — using the current
 * (higher) JDK is fine. Overriding to an older JDK would cause Gradle attribute-matching
 * to reject artifacts published with a newer JDK (`org.gradle.jvm.version` mismatch).
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
    // Minimum version: only override if the current JDK is below the minimum.
    // Using a higher JDK than the minimum is always compatible (that's what "minimum" means).
    // Downgrading to the minimum could cause Gradle to reject artifacts compiled with a newer
    // JDK (org.gradle.jvm.version attribute mismatch).
    if (currentMajor !== null && currentMajor >= required) {
      return passThroughCurrentJdk(env, hint);
    }
    // Current JDK is too old → find one that meets the minimum.
    return findAndOverride(required, hint, env);
  }

  // Exact-version hint (sdkmanrc, .java-version, toolchain, cached-toolchain):
  // Override only when the current JDK major doesn't already match.
  if (currentMajor !== null && currentMajor === required) {
    return passThroughCurrentJdk(env, hint);
  }

  return findAndOverride(required, hint, env);
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
): JdkResolutionResult {
  const found = findJdk(required, env);
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
      `  3. Set org.gradle.java.home in the project's gradle.properties:`,
      `       org.gradle.java.home=/path/to/jdk-${requiredMajor}`,
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
