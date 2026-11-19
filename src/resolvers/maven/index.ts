import fs from 'node:fs';
import path from 'node:path';
import type {
  ArtifactCoordinates,
  BuildCacheInputs,
  DependencyResolver,
  ResolutionResult,
  ResolveOptions,
  ResolveSourcesJarResult,
  ResolvedArtifact,
  SubprocessCapture,
  SubprocessHooks,
} from '../base.js';
import { parseResolutionJson, validateResolutionOutput } from '../resolution-output.js';
import {
  isMavenImmutableArtifact,
  listMavenBuildInputRelativePaths,
  mavenCacheInputs,
  resolveMavenLocalRepository,
} from './cache-inputs.js';
import { resolveMavenSourcesJar } from './resolve-sources-jar.js';
import { captureFromSpawn, runMavenAnalyzer, type MavenSpawnResult } from './spawn-maven.js';

export {
  isMavenImmutableArtifact,
  listMavenBuildInputRelativePaths,
  mavenCacheInputs,
  resolveMavenLocalRepository,
} from './cache-inputs.js';
export { resolveMavenSourcesJar } from './resolve-sources-jar.js';

function hasPomXml(dir: string): boolean {
  try {
    const pom = path.join(dir, 'pom.xml');
    return fs.existsSync(pom) && fs.statSync(pom).isFile();
  } catch {
    return false;
  }
}

function pomDeclaresModuleTarget(aggregatorDir: string, childDir: string): boolean {
  try {
    const xml = fs
      .readFileSync(path.join(aggregatorDir, 'pom.xml'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '');
    const re = /<module>\s*([^<]+?)\s*<\/module>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const modRel = m[1]?.trim();
      if (!modRel) {
        continue;
      }
      const resolvedMod = path.resolve(aggregatorDir, modRel);
      if (resolvedMod === childDir) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Walks up from `start` to the nearest `pom.xml`, then climbs ancestor aggregator `pom.xml`
 * files whose `<modules>` references the child module directory (including multi-segment
 * `<module>services/app</module>`), without crossing into unrelated outer POMs.
 */
export function findMavenBuildRoot(start: string): string | null {
  let dir = path.resolve(start);
  let candidate: string | null = null;

  for (;;) {
    if (hasPomXml(dir)) {
      candidate = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }

  for (;;) {
    let climbed = false;
    let probe = path.dirname(candidate);
    let hops = 0;
    while (probe !== candidate && hops < 8) {
      if (hasPomXml(probe) && pomDeclaresModuleTarget(probe, candidate)) {
        candidate = probe;
        climbed = true;
        break;
      }
      const next = path.dirname(probe);
      if (next === probe) {
        break;
      }
      probe = next;
      hops++;
    }
    if (!climbed) {
      break;
    }
  }

  return candidate;
}

export class MavenResolver implements DependencyResolver {
  readonly id = 'maven';
  readonly displayName = 'Maven';
  readonly rootHint = 'pom.xml';
  readonly configurationNames = {
    compile: ['compile'],
    'test-compile': ['test'],
  } as const;

  detect(projectRoot: string): boolean {
    return hasPomXml(path.resolve(projectRoot));
  }

  findBuildRoot(start: string): string | null {
    return findMavenBuildRoot(start);
  }

  cacheInputs(projectRoot: string): BuildCacheInputs {
    return mavenCacheInputs(projectRoot);
  }

  isImmutableArtifact(artifact: ResolvedArtifact, projectRoot: string): boolean {
    return isMavenImmutableArtifact(artifact, this.localRepositoryFor(projectRoot));
  }

  /**
   * Effective local repository, memoized for one synchronous pass (cleared on the next microtask),
   * so a digest over many artifacts reads the settings once and a long session still sees edits.
   */
  private localRepositoryFor(projectRoot: string): string {
    const root = path.resolve(projectRoot);
    if (this.localRepoMemo?.root === root) {
      return this.localRepoMemo.repo;
    }
    const repo = resolveMavenLocalRepository(root);
    this.localRepoMemo = { root, repo };
    queueMicrotask(() => {
      this.localRepoMemo = null;
    });
    return repo;
  }

  private localRepoMemo: { root: string; repo: string } | null = null;

  async resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolutionResult> {
    const root = path.resolve(projectRoot);
    if (!this.detect(root)) {
      return {
        ok: false,
        message: 'Not a Maven project (no pom.xml at project root)',
      };
    }

    const inherit = Boolean(options?.inheritStderr);
    let spawned: MavenSpawnResult;
    try {
      options?.onBeforeResolve?.({ resolverId: this.id, displayName: this.displayName });
      spawned = await runMavenAnalyzer(root, ['-Djvmsrc.mode=resolve'], {
        inheritStderr: inherit,
      });
    } finally {
      options?.onAfterResolve?.();
    }

    if (!spawned.ok) {
      return {
        ok: false,
        message: spawned.message,
        stderr: spawned.stderr,
        subprocess: captureFromSpawn(spawned),
      };
    }

    let raw: unknown;
    try {
      raw = parseResolutionJson(spawned.outputText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: `Could not parse Maven JSON output: ${msg}`,
        stderr: spawned.stderr || undefined,
        subprocess: captureFromSpawn({ ...spawned, exitCode: 0 }),
      };
    }

    const validated = validateResolutionOutput(raw);
    if (!validated.ok) {
      return {
        ok: false,
        message: validated.message,
        stderr: spawned.stderr || undefined,
        subprocess: captureFromSpawn({ ...spawned, exitCode: 0 }),
      };
    }

    return { ok: true, output: validated.output };
  }

  async resolveSourcesJar(
    projectRoot: string,
    coordinates: ArtifactCoordinates,
    hooks?: SubprocessHooks,
  ): Promise<ResolveSourcesJarResult> {
    return resolveMavenSourcesJar(projectRoot, coordinates, hooks);
  }
}
