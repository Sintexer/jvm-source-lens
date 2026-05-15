import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveJavaExecutable } from './decompiler/resolve-java-executable.js';

/** Repository / package root (directory containing `package.json`). */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

export type JvmsrcMcpConfigPayload = {
  mcpServers: {
    jvmsrc: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
  hints: {
    packageVersion: string;
    projectRoot: string;
    hasGradleWrapper: boolean;
    javaHome: string | null;
    javaDetected: boolean;
  };
};

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8');
    const j = JSON.parse(raw) as { version?: string };
    return typeof j.version === 'string' ? j.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function hasGradleWrapper(projectRoot: string): boolean {
  const unix = path.join(projectRoot, 'gradlew');
  const win = path.join(projectRoot, 'gradlew.bat');
  try {
    if (fs.existsSync(unix)) {
      return fs.statSync(unix).isFile();
    }
    if (fs.existsSync(win)) {
      return fs.statSync(win).isFile();
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * How to spawn the MCP server: dev (`bun run src/mcp.ts`) vs installed (`<cli> mcp`).
 */
export function resolveMcpLaunchArgv(): { command: string; args: string[] } {
  const argv1 = process.argv[1];
  const execBase = path.basename(process.execPath).toLowerCase();
  const isBun = execBase === 'bun' || execBase.startsWith('bun-');

  const isDevCliTs =
    argv1 != null &&
    (argv1.endsWith(`${path.sep}src${path.sep}cli.ts`) ||
      argv1.endsWith('/src/cli.ts') ||
      argv1.endsWith('\\src\\cli.ts'));

  if (isBun && isDevCliTs) {
    const mcpEntry = path.join(PACKAGE_ROOT, 'src', 'mcp.ts');
    return { command: process.execPath, args: ['run', mcpEntry] };
  }

  if (argv1 != null && argv1.length > 0) {
    const base = path.basename(argv1);
    if (base !== 'test' && argv1 !== 'test') {
      return { command: argv1, args: ['mcp'] };
    }
  }

  return { command: 'jvmsrc', args: ['mcp'] };
}

export function buildJvmsrcMcpConfigPayload(projectRoot: string): JvmsrcMcpConfigPayload {
  const { command, args } = resolveMcpLaunchArgv();
  const java = resolveJavaExecutable();
  const javaHome =
    typeof process.env.JAVA_HOME === 'string' && process.env.JAVA_HOME.trim().length > 0
      ? path.resolve(process.env.JAVA_HOME.trim())
      : null;

  return {
    mcpServers: {
      jvmsrc: {
        command,
        args,
        env: {},
      },
    },
    hints: {
      packageVersion: readPackageVersion(),
      projectRoot,
      hasGradleWrapper: hasGradleWrapper(projectRoot),
      javaHome,
      javaDetected: java.ok,
    },
  };
}
