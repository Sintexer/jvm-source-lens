/**
 * Synthetic large-build benchmark (PLAN checkpoint 3). Builds a temp Gradle-shaped tree with N modules,
 * seeds the resolution cache with a synthetic ResolutionOutput whose classpaths use real JARs from
 * ~/.gradle, then times the calls that scan every module when modulePath is omitted. No Gradle run.
 *
 *   bun scripts/bench-large-build.ts                    # 50 modules, 80 JARs per module
 *   bun scripts/bench-large-build.ts --modules 100 --jars 150
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    modules: { type: 'string', default: '50' },
    jars: { type: 'string', default: '80' },
    'gradle-cache': { type: 'string', default: path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1') },
  },
});
const moduleCount = Number(args.modules);
const jarsPerModule = Number(args.jars);

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-bench-')));
process.env.JVMSRC_CACHE_ROOT = path.join(tmp, 'cache');
process.env.JVMSRC_LOG_DIR = path.join(tmp, 'logs');

const { computeBuildInputsDigest, writeCachedResolution } = await import('../src/cache/index.js');
const { searchClasses } = await import('../src/search-classes.js');
const { getClassStructure } = await import('../src/get-class-structure.js');
import type { ResolutionOutput, ResolvedArtifact } from '../src/resolvers/resolution-output.js';

const dirs = (p: string): string[] =>
  fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

function listJars(root: string): { group: string; name: string; version: string; jarPath: string }[] {
  const out: { group: string; name: string; version: string; jarPath: string }[] = [];
  for (const group of dirs(root)) {
    for (const name of dirs(path.join(root, group))) {
      for (const version of dirs(path.join(root, group, name))) {
        const vdir = path.join(root, group, name, version);
        for (const hash of dirs(vdir)) {
          for (const f of fs.readdirSync(path.join(vdir, hash))) {
            if (f === `${name}-${version}.jar`) {
              out.push({ group, name, version, jarPath: path.join(vdir, hash, f) });
            }
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.jarPath.localeCompare(b.jarPath));
}

const jars = listJars(args['gradle-cache']!);
if (jars.length === 0) {
  throw new Error(`No JARs under ${args['gradle-cache']}; resolve the eval project once first.`);
}

const projectRoot = path.join(tmp, 'project');
fs.mkdirSync(projectRoot, { recursive: true });
const names = Array.from({ length: moduleCount }, (_, i) => `m${String(i).padStart(3, '0')}`);
fs.writeFileSync(path.join(projectRoot, 'settings.gradle'), names.map((n) => `include '${n}'`).join('\n'));
for (const n of names) {
  const src = path.join(projectRoot, n, 'src/main/java/bench', n);
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, n, 'build.gradle'), "plugins { id 'java-library' }\n");
  fs.writeFileSync(path.join(src, 'Service.java'), `package bench.${n};\n\npublic class Service {}\n`);
}

const modules = names.map((n, i) => {
  const external: ResolvedArtifact[] = Array.from({ length: Math.min(jarsPerModule, jars.length) }, (_, k) => {
    const j = jars[(i * 7 + k) % jars.length]!;
    return { group: j.group, name: j.name, version: j.version, type: 'jar', jarPath: j.jarPath, sourcesJarPath: null, origin: 'external', direct: k < 10 };
  });
  const siblings: ResolvedArtifact[] = [names[i - 1], names[i - 2]]
    .filter((s): s is string => s !== undefined)
    .map((s) => ({
      group: 'bench', name: s, version: null, type: 'project', jarPath: null, sourcesJarPath: null,
      origin: 'interproject', direct: true, interproject: { moduleName: `:${s}`, modulePath: path.join(projectRoot, s) },
    }));
  return {
    name: `:${n}`,
    path: path.join(projectRoot, n),
    configurations: [{ name: 'compileClasspath', scope: 'compile' as const, artifacts: [...siblings, ...external] }],
  };
});

const output: ResolutionOutput = {
  schemaVersion: '1.1',
  resolvedAt: new Date().toISOString(),
  buildSystem: { type: 'gradle', version: '9.0', wrapper: true },
  projectRoot,
  modules,
  errors: [],
};
const written = writeCachedResolution(projectRoot, output, computeBuildInputsDigest(projectRoot));
if (!written.ok) {
  throw new Error(written.message);
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(58)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms`);
  return r;
}

const commonClass = 'org.slf4j.Logger';
console.log(`${moduleCount} modules, ${Math.min(jarsPerModule, jars.length)} JARs each (${jars.length} distinct in cache), root ${projectRoot}\n`);
await time('search_classes "Service" (cold: builds per-module indexes)', () => searchClasses({ projectRoot, query: 'Service' }));
await time('search_classes "Service" (warm)', () => searchClasses({ projectRoot, query: 'Service' }));
await time(`get_class_structure ${commonClass} (no modulePath)`, () => getClassStructure(commonClass, { projectRoot }));
await time('get_class_structure Service (simple name, no modulePath)', () => getClassStructure('Service', { projectRoot }));
await time('get_class_structure bench.m025.Service (no modulePath)', () => getClassStructure('bench.m025.Service', { projectRoot }));
await time('get_class_structure no.such.Clazz (no modulePath)', () => getClassStructure('no.such.Clazz', { projectRoot }));

fs.rmSync(tmp, { recursive: true, force: true });
