import { detectRequiredJavaVersion, readGradleWrapperMaxJava } from './detect-required-version.js';
import { inspectJdkCandidates } from './find-jdk.js';
import { readJdkReleaseFile } from './read-jdk-release-file.js';
import { resolveJdkForProject } from './resolve-jdk-for-project.js';

export interface JavaDoctorReport {
  ok: boolean;
  text: string;
}

function describeHint(hint: ReturnType<typeof detectRequiredJavaVersion>): string {
  switch (hint.source) {
    case 'jvmsrc-java-home':
      return `JVMSRC_JAVA_HOME (${hint.path})`;
    case 'gradle-properties-home':
      return `org.gradle.java.home (${hint.path})`;
    case 'sdkmanrc':
      return `.sdkmanrc (Java ${hint.majorVersion})`;
    case 'java-version-file':
      return `.java-version (Java ${hint.majorVersion})`;
    case 'toolchain-script':
      return `build script / gradle.properties toolchain hint (Java ${hint.majorVersion})`;
    case 'cached-toolchain':
      return `cached toolchain (Java ${hint.majorVersion})`;
    case 'gradle-wrapper-inferred':
      return `gradle wrapper inferred minimum (Java ${hint.majorVersion})`;
    case 'none':
      return 'no project-specific hint';
    default:
      return hint.source;
  }
}

function describeRequirement(
  projectRoot: string,
  hint: ReturnType<typeof detectRequiredJavaVersion>,
): { requiredMajor?: number; range?: { minMajor: number; maxMajor: number }; text: string } {
  if (hint.source === 'none') {
    return { text: 'none (will use current JAVA_HOME or best available JDK)' };
  }
  if (hint.source === 'jvmsrc-java-home' || hint.source === 'gradle-properties-home') {
    return { text: `explicit JDK path (${hint.path})` };
  }
  if (hint.source === 'gradle-wrapper-inferred') {
    const max = readGradleWrapperMaxJava(projectRoot);
    if (max !== null) {
      return {
        requiredMajor: hint.majorVersion,
        range: { minMajor: hint.majorVersion, maxMajor: max },
        text: `Java range ${hint.majorVersion}..${max}`,
      };
    }
    return {
      requiredMajor: hint.majorVersion,
      text: `Java >= ${hint.majorVersion}`,
    };
  }
  return {
    requiredMajor: hint.majorVersion,
    text: `Java ${hint.majorVersion}`,
  };
}

function describeCurrentJavaHome(env: NodeJS.ProcessEnv): string {
  const javaHome = env['JAVA_HOME']?.trim();
  if (!javaHome) {
    return 'not set';
  }
  const rel = readJdkReleaseFile(javaHome);
  if (!rel) {
    return `${javaHome} (invalid JDK home)`;
  }
  return `${javaHome} (Java ${rel.majorVersion}, ${rel.fullVersion})`;
}

export function runJavaDoctor(
  projectRoot: string,
  opts: {
    cachedToolchainVersion?: number;
    env?: NodeJS.ProcessEnv;
    ctx?: { homeDir?: string; platform?: NodeJS.Platform };
  } = {},
): JavaDoctorReport {
  const env = opts.env ?? process.env;
  const hint = detectRequiredJavaVersion(projectRoot, {
    env,
    cachedToolchainVersion: opts.cachedToolchainVersion,
  });
  const requirement = describeRequirement(projectRoot, hint);
  const resolved = resolveJdkForProject(projectRoot, opts.cachedToolchainVersion, env, opts.ctx);
  const inspections = inspectJdkCandidates(requirement.requiredMajor, requirement.range, env, opts.ctx);

  const lines: string[] = [];
  lines.push('Java Doctor');
  lines.push(`Project: ${projectRoot}`);
  lines.push(`Hint source: ${describeHint(hint)}`);
  lines.push(`Requirement: ${requirement.text}`);
  lines.push(`Current JAVA_HOME: ${describeCurrentJavaHome(env)}`);
  lines.push('');

  if (resolved.ok) {
    lines.push(
      `Selected JDK: ${resolved.jdkHome} (Java ${resolved.majorVersion}, ${resolved.fullVersion}; hint=${resolved.hint.source})`,
    );
    lines.push('Status: OK');
  } else {
    lines.push('Selected JDK: not found');
    lines.push('Status: FAIL');
    lines.push('');
    lines.push('Failure message:');
    lines.push(resolved.message);
  }

  lines.push('');
  lines.push(`Candidate scan (${inspections.length} unique paths):`);
  if (inspections.length === 0) {
    lines.push('- none');
  } else {
    for (const candidate of inspections) {
      if (!candidate.valid) {
        lines.push(`- [invalid-jdk-home] ${candidate.jdkHome} (source=${candidate.source})`);
        continue;
      }
      const verdict = candidate.matchesRequirement ? 'match' : candidate.decision;
      lines.push(
        `- [${verdict}] ${candidate.jdkHome} (source=${candidate.source}, java=${candidate.majorVersion}, version=${candidate.fullVersion})`,
      );
    }
  }

  return {
    ok: resolved.ok,
    text: lines.join('\n'),
  };
}
