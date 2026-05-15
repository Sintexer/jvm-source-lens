import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveGlobalCacheRoot } from '../cache/paths.js';
import type { DiagnosticRecord } from './diagnostic-record.js';

function readGradleWrapperVersion(projectRoot: string): string | null {
  const p = path.join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  try {
    const text = fs.readFileSync(p, 'utf8');
    const m = text.match(/distributionUrl=.*\/gradle-([^-/]+)-/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function tryJavaVersion(javaExecutable?: string): string | null {
  const java = javaExecutable ?? 'java';
  try {
    const r = spawnSync(java, ['-version'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
    });
    const out = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.trim();
    const line = out.split('\n')[0]?.trim();
    return line && line.length > 0 ? line.slice(0, 400) : null;
  } catch {
    return null;
  }
}

export type BuildDiagnosticContextOptions = {
  projectRoot: string;
  buildSystem: string | null;
  javaExecutable?: string;
};

export function buildDiagnosticContextSync(opts: BuildDiagnosticContextOptions): DiagnosticRecord['context'] {
  const cache = resolveGlobalCacheRoot();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    javaVersion: tryJavaVersion(opts.javaExecutable),
    gradleVersion: readGradleWrapperVersion(opts.projectRoot),
    projectRoot: path.resolve(opts.projectRoot),
    buildSystem: opts.buildSystem,
    cacheDir: cache.ok ? cache.path : '',
  };
}

/** Resolve package version from repo `package.json` (same pattern as `cli.ts`). */
export function readToolVersionFromPackage(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const v = JSON.parse(raw) as { version?: string };
    return v.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
