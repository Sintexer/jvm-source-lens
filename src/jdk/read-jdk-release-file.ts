import fs from 'node:fs';
import path from 'node:path';

/**
 * Parsed subset of a JDK `release` file.
 * The `release` file lives at `$JAVA_HOME/release` (all modern JDKs ≥ 9).
 */
export interface JdkReleaseInfo {
  /** Full version string as reported in the release file, e.g. "17.0.11" or "1.8.0_392". */
  fullVersion: string;
  /** Resolved Java major version number, e.g. 17, 11, 8. */
  majorVersion: number;
}

/**
 * Attempts to read and parse the `release` file at `<jdkHome>/release`.
 * Returns `null` if the file is absent, unreadable, or does not contain a valid JAVA_VERSION line.
 *
 * No subprocess is spawned — this is a purely synchronous file read.
 */
export function readJdkReleaseFile(jdkHome: string): JdkReleaseInfo | null {
  const releasePath = path.join(jdkHome, 'release');
  let text: string;
  try {
    text = fs.readFileSync(releasePath, 'utf8');
  } catch {
    return null;
  }
  return parseReleaseFileText(text);
}

/**
 * Parses the text content of a JDK `release` file and extracts the Java major version.
 * Exported for unit testing.
 */
export function parseReleaseFileText(text: string): JdkReleaseInfo | null {
  // The JAVA_VERSION line looks like: JAVA_VERSION="17.0.11"  or  JAVA_VERSION="1.8.0_392"
  const match = text.match(/^JAVA_VERSION="([^"]+)"/m);
  if (!match) {
    return null;
  }
  const fullVersion = match[1];
  const major = parseMajorVersion(fullVersion);
  if (major === null) {
    return null;
  }
  return { fullVersion, majorVersion: major };
}

/**
 * Extracts the Java major version from a version string.
 *
 * Handles both modern (9+) and legacy (1.x) version schemes:
 *   - "17.0.11"  → 17
 *   - "21"       → 21
 *   - "1.8.0_392" → 8  (legacy Java 8 / pre-9 versioning)
 */
export function parseMajorVersion(version: string): number | null {
  const parts = version.split('.');
  if (parts.length === 0) {
    return null;
  }
  const first = parseInt(parts[0], 10);
  if (!Number.isInteger(first) || first < 0) {
    return null;
  }
  // Legacy scheme: "1.X" → X (Java ≤ 8)
  if (first === 1 && parts.length >= 2) {
    const second = parseInt(parts[1], 10);
    if (Number.isInteger(second) && second > 0) {
      return second;
    }
  }
  return first;
}
