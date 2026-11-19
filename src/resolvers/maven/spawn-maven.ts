import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBundledResource } from '../../bundled-resources.js';
import { readCachedJavaToolchainVersion } from '../../cache/cached-toolchain.js';
import { buildCfrSpawnEnv } from '../../decompiler/cfr-spawn-env.js';
import { resolveJdkForProject } from '../../jdk/resolve-jdk-for-project.js';
import { awaitChildExit, readProcessStreamToText, spawnChild } from '../../spawn-child.js';
import type { SubprocessCapture } from '../base.js';
import { formatMavenUserMessage } from './maven-failure-message.js';
import { mavenArgsRepoLocalArg } from './cache-inputs.js';
import { resolveMavenWrapperCommand } from './maven-wrapper-command.js';

export { resolveMavenWrapperCommand } from './maven-wrapper-command.js';

/** Default wall-clock cap for each Maven invocation. Override with `JVMSRC_MAVEN_TIMEOUT_MS`. */
export const DEFAULT_MAVEN_TIMEOUT_MS = 600_000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

export function mavenTimeoutMs(): number {
  return parsePositiveIntEnv('JVMSRC_MAVEN_TIMEOUT_MS', DEFAULT_MAVEN_TIMEOUT_MS);
}

/**
 * Joins `analyzerJarPath` with any `-Dmaven.ext.class.path=...` already declared in
 * `.mvn/maven.config` so existing core extensions continue to load alongside jvmsrc's analyzer.
 */
export function mergeMavenExtClassPath(projectRoot: string, analyzerJarPath: string): string {
  const configPath = path.join(projectRoot, '.mvn', 'maven.config');
  try {
    if (!fs.existsSync(configPath)) {
      return analyzerJarPath;
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const existing: string[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const matches = trimmed.matchAll(
        /-Dmaven\.ext\.class\.path=(?:"([^"]+)"|'([^']+)'|(\S+))/g,
      );
      for (const m of matches) {
        const val = (m[1] ?? m[2] ?? m[3] ?? '').trim();
        if (val.length > 0) {
          existing.push(val);
        }
      }
    }
    if (existing.length === 0) {
      return analyzerJarPath;
    }
    return [...existing, analyzerJarPath].join(path.delimiter);
  } catch {
    return analyzerJarPath;
  }
}

export type MavenSpawnResult =
  | { ok: true; outputText: string; stdout: string; stderr: string; command: string[] }
  | {
      ok: false;
      message: string;
      stderr?: string;
      stdout?: string;
      command: string[];
      exitCode: number | null;
    };

/** Subprocess capture for diagnostics, from a spawn result or any `{ command, exitCode?, stdout?, stderr? }`. */
export function captureFromSpawn(spawned: {
  command: string[];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}): SubprocessCapture {
  return {
    command: spawned.command,
    exitCode: spawned.exitCode ?? null,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
  };
}

export const MAVEN_OUTPUT_MISSING_MESSAGE =
  'Maven finished but the jvmsrc analyzer wrote no output file. The analyzer extension probably did not load: check .mvn/extensions.xml, .mvn/maven.config (-Dmaven.ext.class.path) and the Maven log.';

/** The analyzer result file, or null when Maven exited 0 without writing it. */
export function readMavenOutputFile(outputFile: string): string | null {
  return fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
}

export type RunMavenSpawnOptions = {
  inheritStderr?: boolean;
  timeoutMs?: number;
  cachedToolchainVersion?: number;
};

function formatMavenFailureTail(baseMessage: string, stdout: string, stderr: string): string {
  const combined = `${stderr}\n${stdout}`;
  const errorLines = combined
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('[ERROR]') || l.startsWith('Caused by:'))
    .slice(-5);
  if (errorLines.length > 0) {
    return `${baseMessage}: ${errorLines.join(' | ')}`;
  }
  const fallback = combined
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-3);
  return fallback.length > 0 ? `${baseMessage}: ${fallback.join(' | ')}` : baseMessage;
}

/**
 * Runs Maven `validate` in `projectRoot` with the bundled `maven-analyzer.jar` core extension,
 * reading JSON output from an isolated temp file outside `projectRoot`.
 */
export async function runMavenAnalyzer(
  projectRoot: string,
  systemPropertyArgs: string[],
  spawnOptions?: RunMavenSpawnOptions,
): Promise<MavenSpawnResult> {
  const root = path.resolve(projectRoot);
  const wrapper = resolveMavenWrapperCommand(root);
  const useWrapper = wrapper.useWrapper;

  if (wrapper.lfsPointerJar) {
    const jarRel = path.join('.mvn', 'wrapper', 'maven-wrapper.jar');
    return {
      ok: false,
      message: [
        `.mvn/wrapper/maven-wrapper.jar is a Git LFS pointer, not a real JAR.`,
        `Maven Wrapper cannot start.`,
        `Fix: run \`git lfs pull\` in ${root}, regenerate the wrapper with \`mvn wrapper:wrapper\`,`,
        `or set JVMSRC_USE_SYSTEM_MAVEN=1 to use a system Maven installation.`,
      ].join('\n'),
      command: [path.join(root, 'mvnw'), jarRel],
      exitCode: null,
    };
  }

  const cachedToolchainVersion =
    spawnOptions?.cachedToolchainVersion ?? readCachedJavaToolchainVersion(root);
  const jdkResult = resolveJdkForProject(root, cachedToolchainVersion);
  if (!jdkResult.ok) {
    return {
      ok: false,
      message: jdkResult.message,
      command: [],
      exitCode: null,
    };
  }

  const analyzerJar = getBundledResource('maven-analyzer.jar');
  const extClassPath = mergeMavenExtClassPath(root, analyzerJar);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-out-'));
  const outputFile = path.join(tmpDir, 'output.json');

  const repoLocalArg = mavenArgsRepoLocalArg(root);
  const argv: string[] = [
    ...wrapper.command,
    '-B',
    '-q',
    ...(repoLocalArg ? [repoLocalArg] : []),
    `-Dmaven.ext.class.path=${extClassPath}`,
    `-Djvmsrc.wrapper=${useWrapper ? 'true' : 'false'}`,
    `-Djvmsrc.projectRoot=${root}`,
    `-Djvmsrc.outputFile=${outputFile}`,
    ...systemPropertyArgs,
    'validate',
  ];

  try {
    let proc: ReturnType<typeof spawnChild>;
    try {
      const childEnv = buildCfrSpawnEnv(process.env, jdkResult.jdkHome);
      delete childEnv['MAVEN_OPTS'];
      proc = spawnChild(argv, {
        cwd: root,
        stdout: 'pipe',
        stderr: spawnOptions?.inheritStderr ? 'inherit' : 'pipe',
        stdin: 'ignore',
        env: childEnv,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: formatMavenUserMessage({
          kind: 'spawn',
          message: `Failed to start Maven (${argv[0] ?? 'mvn'}): ${msg}`,
          command: argv,
          usedWrapper: useWrapper,
        }),
        command: argv,
        exitCode: null,
      };
    }

    const timeoutMs = spawnOptions?.timeoutMs ?? mavenTimeoutMs();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    let stdout: string;
    let stderr: string;
    let exitCode: number;
    try {
      [stdout, stderr, exitCode] = await Promise.all([
        readProcessStreamToText(proc.stdout),
        readProcessStreamToText(proc.stderr),
        awaitChildExit(proc),
      ]);
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: formatMavenUserMessage({
          kind: 'spawn',
          message: `Failed to start Maven (${argv[0] ?? 'mvn'}): ${msg}`,
          command: argv,
          usedWrapper: useWrapper,
        }),
        command: argv,
        exitCode: null,
      };
    }
    clearTimeout(timer);

    if (timedOut) {
      return {
        ok: false,
        message: formatMavenUserMessage({
          kind: 'timeout',
          message: `Maven timed out after ${timeoutMs}ms`,
          command: argv,
          usedWrapper: useWrapper,
        }),
        stderr: stderr || undefined,
        stdout,
        command: argv,
        exitCode: null,
      };
    }

    if (exitCode !== 0) {
      return {
        ok: false,
        message: formatMavenUserMessage({
          kind: 'exit',
          message: formatMavenFailureTail(`Maven exited with code ${exitCode}`, stdout, stderr),
          stderr,
          stdout,
          command: argv,
          usedWrapper: useWrapper,
        }),
        stderr: (stderr || stdout) || undefined,
        stdout,
        command: argv,
        exitCode,
      };
    }

    const outputText = readMavenOutputFile(outputFile);
    if (outputText === null) {
      return {
        ok: false,
        message: MAVEN_OUTPUT_MISSING_MESSAGE,
        stderr: (stderr || stdout) || undefined,
        stdout,
        command: argv,
        exitCode,
      };
    }

    return { ok: true, outputText, stdout, stderr, command: argv };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
