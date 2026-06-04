import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJdkReleaseFile, type JdkReleaseInfo } from './read-jdk-release-file.js';

export interface FoundJdk {
  /** Absolute path to the JDK home directory (value to use as `JAVA_HOME`). */
  jdkHome: string;
  /** Full version string from the `release` file, e.g. "17.0.11". */
  fullVersion: string;
  /** Resolved major version, e.g. 17. */
  majorVersion: number;
  /** How this JDK was found. */
  source: JdkSearchSource;
}

export type JdkSearchSource =
  | 'java-home-env'          // $JAVA_HOME env var
  | 'gradle-jdks'            // ~/.gradle/jdks/ (Gradle auto-provisioned toolchain JDKs)
  | 'sdkman'                 // ~/.sdkman/candidates/java/
  | 'jenv'                   // ~/.jenv/versions/
  | 'asdf'                   // ~/.asdf/installs/java/
  | 'homebrew'               // /opt/homebrew/opt/openjdk* or /usr/local/opt/openjdk*
  | 'linux-system'           // /usr/lib/jvm/
  | 'macos-system'           // /Library/Java/JavaVirtualMachines/
  | 'jabba';                 // ~/.jabba/jdk/

/** A candidate JDK path discovered during search, before version validation. */
interface JdkCandidate {
  jdkHome: string;
  source: JdkSearchSource;
}

// ---------------------------------------------------------------------------
// Candidate collectors — return zero or more candidate homes per source
// ---------------------------------------------------------------------------

function listDirEntries(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Yields candidate subdirectories inside `parentDir`. */
function subdirCandidates(parentDir: string, source: JdkSearchSource): JdkCandidate[] {
  return listDirEntries(parentDir)
    .map((name) => path.join(parentDir, name))
    .filter(isDir)
    .map((jdkHome) => ({ jdkHome, source }));
}

function javaHomeCandidates(env: NodeJS.ProcessEnv): JdkCandidate[] {
  const h = env['JAVA_HOME']?.trim();
  if (h && isDir(h)) {
    return [{ jdkHome: h, source: 'java-home-env' }];
  }
  return [];
}

function gradleJdksCandidates(): JdkCandidate[] {
  // ~/.gradle/jdks/ contains entries like "openjdk-17.0.6+10/"
  // Each entry may itself contain the JDK home or a subdirectory with it.
  const base = path.join(os.homedir(), '.gradle', 'jdks');
  const top = subdirCandidates(base, 'gradle-jdks');
  // Gradle 8.8+ nests: ~/.gradle/jdks/<dist>/<version>/<platform>/
  const nested: JdkCandidate[] = [];
  for (const c of top) {
    const children = subdirCandidates(c.jdkHome, 'gradle-jdks');
    if (children.length > 0) {
      nested.push(...children);
    }
  }
  return [...top, ...nested];
}

function sdkmanCandidates(): JdkCandidate[] {
  const base = path.join(os.homedir(), '.sdkman', 'candidates', 'java');
  // ~/.sdkman/candidates/java/<version>/ — skip the "current" symlink
  return listDirEntries(base)
    .filter((name) => name !== 'current')
    .map((name) => path.join(base, name))
    .filter(isDir)
    .map((jdkHome) => ({ jdkHome, source: 'sdkman' as const }));
}

function jenvCandidates(): JdkCandidate[] {
  // ~/.jenv/versions/ contains symlinks to actual JDK homes
  const base = path.join(os.homedir(), '.jenv', 'versions');
  return listDirEntries(base)
    .map((name) => {
      const p = path.join(base, name);
      try {
        // Resolve symlinks to get the real JDK home
        return { jdkHome: fs.realpathSync(p), source: 'jenv' as const };
      } catch {
        return { jdkHome: p, source: 'jenv' as const };
      }
    })
    .filter((c) => isDir(c.jdkHome));
}

function asdfCandidates(): JdkCandidate[] {
  const base = path.join(os.homedir(), '.asdf', 'installs', 'java');
  return subdirCandidates(base, 'asdf');
}

function homebrewCandidates(): JdkCandidate[] {
  const bases = [
    path.join('/opt', 'homebrew', 'opt'),   // Apple Silicon
    path.join('/usr', 'local', 'opt'),       // Intel
  ];
  const candidates: JdkCandidate[] = [];
  for (const base of bases) {
    for (const name of listDirEntries(base)) {
      if (!name.startsWith('openjdk')) {
        continue;
      }
      // Homebrew openjdk formula puts the JDK under libexec/
      const libexec = path.join(base, name, 'libexec');
      if (isDir(libexec)) {
        // On macOS, the actual JAVA_HOME is libexec/openjdk.jdk/Contents/Home
        const contentsHome = path.join(libexec, 'openjdk.jdk', 'Contents', 'Home');
        candidates.push({
          jdkHome: isDir(contentsHome) ? contentsHome : libexec,
          source: 'homebrew',
        });
      } else {
        const direct = path.join(base, name);
        if (isDir(direct)) {
          candidates.push({ jdkHome: direct, source: 'homebrew' });
        }
      }
    }
  }
  return candidates;
}

function macosSystemCandidates(): JdkCandidate[] {
  const base = '/Library/Java/JavaVirtualMachines';
  const candidates: JdkCandidate[] = [];
  for (const name of listDirEntries(base)) {
    // Standard macOS layout: <name>.jdk/Contents/Home
    const contentsHome = path.join(base, name, 'Contents', 'Home');
    if (isDir(contentsHome)) {
      candidates.push({ jdkHome: contentsHome, source: 'macos-system' });
    }
  }
  return candidates;
}

function linuxSystemCandidates(): JdkCandidate[] {
  return subdirCandidates('/usr/lib/jvm', 'linux-system');
}

function jabbaCandidates(): JdkCandidate[] {
  const base = path.join(os.homedir(), '.jabba', 'jdk');
  return subdirCandidates(base, 'jabba');
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns the major version of a candidate JDK home, or null if it cannot be determined
 * from the `release` file. Does not spawn any subprocess.
 */
function validateCandidate(candidate: JdkCandidate): FoundJdk | null {
  let info: JdkReleaseInfo | null = readJdkReleaseFile(candidate.jdkHome);

  // Some Gradle JDK installs keep the JDK one level deeper (e.g. containing a single subdir)
  if (!info) {
    const children = listDirEntries(candidate.jdkHome).filter((n) =>
      isDir(path.join(candidate.jdkHome, n)),
    );
    if (children.length === 1) {
      const child = children[0];
      if (child) {
        const nestedPath = path.join(candidate.jdkHome, child);
        info = readJdkReleaseFile(nestedPath);
        if (info) {
          return {
            jdkHome: nestedPath,
            fullVersion: info.fullVersion,
            majorVersion: info.majorVersion,
            source: candidate.source,
          };
        }
      }
    }
  }

  if (!info) {
    return null;
  }
  return {
    jdkHome: candidate.jdkHome,
    fullVersion: info.fullVersion,
    majorVersion: info.majorVersion,
    source: candidate.source,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Searches all known JDK installation locations on the current machine for a JDK
 * matching the requested major version.
 *
 * Returns the **highest patch version** matching `requiredMajor` to prefer
 * more up-to-date / patched builds. If `requiredMajor` is `undefined`, returns
 * the highest available JDK across all locations.
 *
 * No subprocess is spawned. Version information is read from each candidate's
 * `release` file (`$JAVA_HOME/release`).
 *
 * @param requiredMajor - The Java major version to find (e.g. 17, 21). `undefined` = any.
 * @param env           - Environment to read `JAVA_HOME` from. Defaults to `process.env`.
 */
export function findJdk(
  requiredMajor: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): FoundJdk | null {
  const platform = process.platform;

  // Build the ordered list of candidate sources
  const allCandidates: JdkCandidate[] = [
    ...javaHomeCandidates(env),
    ...gradleJdksCandidates(),
    ...sdkmanCandidates(),
    ...jenvCandidates(),
    ...asdfCandidates(),
    ...(platform === 'darwin' ? homebrewCandidates() : []),
    ...(platform === 'darwin' ? macosSystemCandidates() : []),
    ...(platform === 'linux' ? linuxSystemCandidates() : []),
    ...jabbaCandidates(),
  ];

  // Validate and filter
  const matching: FoundJdk[] = [];
  const seen = new Set<string>();

  for (const candidate of allCandidates) {
    const real = (() => {
      try {
        return fs.realpathSync(candidate.jdkHome);
      } catch {
        return candidate.jdkHome;
      }
    })();
    if (seen.has(real)) {
      continue;
    }
    seen.add(real);

    const found = validateCandidate(candidate);
    if (!found) {
      continue;
    }
    if (requiredMajor === undefined || found.majorVersion === requiredMajor) {
      matching.push(found);
    }
  }

  if (matching.length === 0) {
    return null;
  }

  // Return the highest patch version for stability preference
  return matching.reduce((best, current) => {
    if (current.majorVersion > best.majorVersion) {
      return current;
    }
    if (current.majorVersion === best.majorVersion && current.fullVersion > best.fullVersion) {
      return current;
    }
    return best;
  });
}

/**
 * Returns all JDK locations searched when looking for a given major version.
 * Used to build actionable error messages when no JDK is found.
 */
export function jdkSearchLocations(): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const locations = [
    '$JAVA_HOME (environment variable)',
    path.join(home, '.gradle', 'jdks') + '  (Gradle auto-provisioned toolchain JDKs)',
    path.join(home, '.sdkman', 'candidates', 'java') + '  (SDKMan)',
    path.join(home, '.jenv', 'versions') + '  (jenv)',
    path.join(home, '.asdf', 'installs', 'java') + '  (asdf)',
  ];
  if (platform === 'darwin') {
    locations.push(
      '/opt/homebrew/opt/openjdk*  (Homebrew, Apple Silicon)',
      '/usr/local/opt/openjdk*  (Homebrew, Intel)',
      '/Library/Java/JavaVirtualMachines  (macOS system JDKs)',
    );
  }
  if (platform === 'linux') {
    locations.push('/usr/lib/jvm  (Linux system JDKs)');
  }
  locations.push(path.join(home, '.jabba', 'jdk') + '  (jabba)');
  return locations;
}
