export type GradleFailureKind = 'spawn' | 'exit' | 'timeout';

export type FormatGradleUserMessageParams = {
  task: string;
  kind: GradleFailureKind;
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
  if (hint.length === 0) {
    return base;
  }
  return `${base}\n${hint}`;
}

function authHint(blob: string): string {
  const lower = blob.toLowerCase();
  if (
    /\b401\b/.test(blob) ||
    /\b403\b/.test(blob) ||
    /\bunauthorized\b/.test(lower) ||
    /could not get/i.test(blob) ||
    /received status code/i.test(lower) ||
    (/repository/i.test(blob) && /credential/i.test(lower))
  ) {
    return 'Hint: private repository auth failed — check gradle.properties, ~/.gradle/gradle.properties, or CI credential env vars.';
  }
  return '';
}

function javaHint(blob: string): string {
  const lower = blob.toLowerCase();
  if (
    /\bJAVA_HOME\b/.test(blob) ||
    /unsupported class file/i.test(blob) ||
    /invalid source release/i.test(lower) ||
    /toolchain/i.test(lower) && /jdk|java\b/i.test(blob)
  ) {
    return 'Hint: set JVMSRC_JAVA_HOME to the JDK this project expects (e.g. Java 17) so jvmsrc passes the right JAVA_HOME to Gradle, regardless of your system JAVA_HOME.';
  }
  return '';
}

function wrapperHint(usedWrapper: boolean, command: string[]): boolean {
  return !usedWrapper && command.length > 0 && command[0] === 'gradle';
}

/**
 * Turns raw Gradle failure text into a short primary line plus one optional hint.
 */
export function formatGradleUserMessage(p: FormatGradleUserMessageParams): string {
  if (p.kind === 'timeout') {
    return appendHint(
      p.message,
      'Hint: increase JVMSRC_GRADLE_TIMEOUT_MS or fix a stuck Gradle build.',
    );
  }

  if (p.kind === 'spawn') {
    if (wrapperHint(p.usedWrapper, p.command)) {
      return appendHint(
        p.message,
        'Hint: install Gradle on PATH or add a Gradle wrapper (gradlew) to the project.',
      );
    }
    return p.message;
  }

  const blob = combinedLog(p.stderr, p.stdout);
  const auth = authHint(blob);
  if (auth) {
    return appendHint(p.message, auth);
  }
  const java = javaHint(blob);
  if (java) {
    return appendHint(p.message, java);
  }
  return p.message;
}
