export type MavenFailureKind = 'spawn' | 'exit' | 'timeout';

export type FormatMavenUserMessageParams = {
  kind: MavenFailureKind;
  message: string;
  stderr?: string;
  stdout?: string;
  command: string[];
  usedWrapper: boolean;
};

function combinedLog(stderr: string | undefined, stdout: string | undefined): string {
  const a = stderr?.trim() ?? '';
  const b = stdout?.trim() ?? '';
  if (a && b) {
    return `${a}\n${b}`;
  }
  return a || b;
}

function appendHint(base: string, hint: string): string {
  return hint.length === 0 ? base : `${base}\n${hint}`;
}

function offlineHint(blob: string): string {
  if (/in offline mode/i.test(blob) || /cannot access .* offline/i.test(blob)) {
    return 'Hint: Maven ran in offline mode (-o in .mvn/maven.config or ~/.m2/settings.xml) and a required artifact is not cached locally.';
  }
  return '';
}

function authHint(blob: string): string {
  const lower = blob.toLowerCase();
  if (
    /\b401\b/.test(blob) ||
    /\b403\b/.test(blob) ||
    /\bunauthorized\b/.test(lower) ||
    /\bnot authorized\b/.test(lower) ||
    /\bauthentication failed\b/.test(lower)
  ) {
    return 'Hint: private repository authentication failed — check <servers> in ~/.m2/settings.xml (matching the repository <id>) or credential env vars.';
  }
  return '';
}

function missingArtifactHint(blob: string): string {
  if (
    /could not find artifact/i.test(blob) ||
    /failure to find/i.test(blob) ||
    /was not found in/i.test(blob)
  ) {
    return 'Hint: Maven could not find the declared artifact — verify groupId:artifactId:version in pom.xml and configured <repositories> / mirrors.';
  }
  return '';
}

function javaHint(blob: string): string {
  const lower = blob.toLowerCase();
  const isJdkRelated =
    /unsupportedclassversionerror/i.test(blob) ||
    /unsupported class file/i.test(blob) ||
    /release version .* not supported/i.test(lower) ||
    /invalid target release/i.test(lower) ||
    /invalid source release/i.test(lower) ||
    /\bJAVA_HOME\b/.test(blob);

  if (!isJdkRelated) {
    return '';
  }

  const versionMatch =
    blob.match(/release version\s+(\d+)\s+not supported/i) ??
    blob.match(/target release:?\s*(\d+)/i) ??
    blob.match(/source release:?\s*(\d+)/i);
  const requiredVersion = versionMatch ? versionMatch[1] : null;

  if (requiredVersion) {
    return [
      `Hint: this project requires Java ${requiredVersion}.`,
      `Install JDK ${requiredVersion} and set JVMSRC_JAVA_HOME to its home directory.`,
      `Re-running without a matching JDK will produce the same error.`,
    ].join('\n');
  }

  return [
    `Hint: set JVMSRC_JAVA_HOME to the JDK this Maven project expects (e.g. Java 17).`,
    `Re-running without a matching JDK will produce the same error.`,
  ].join('\n');
}

/**
 * Formats a raw Maven spawn/timeout/exit error with one concise remediation hint when recognizable.
 */
export function formatMavenUserMessage(p: FormatMavenUserMessageParams): string {
  if (p.kind === 'timeout') {
    return appendHint(
      p.message,
      'Hint: increase JVMSRC_MAVEN_TIMEOUT_MS or check repository/network responsiveness.',
    );
  }

  if (p.kind === 'spawn') {
    if (!p.usedWrapper) {
      return appendHint(
        p.message,
        'Hint: install Maven on PATH (or set MAVEN_HOME / JVMSRC_MAVEN_BIN) or add a Maven wrapper (mvnw) to the project.',
      );
    }
    return p.message;
  }

  const blob = combinedLog(p.stderr, p.stdout);
  for (const hintFn of [offlineHint, authHint, missingArtifactHint, javaHint]) {
    const hint = hintFn(blob);
    if (hint) {
      return appendHint(p.message, hint);
    }
  }
  return p.message;
}
