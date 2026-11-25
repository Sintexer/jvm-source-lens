/**
 * bun scripts/bench-hierarchy.ts       (Bun + JDK 11+, no network or Gradle)
 * 300 synthetic dependency JARs, 64 unique javac-generated classes/interfaces per JAR.
 * Resolution is preseeded; first lookup has no hierarchy indexes, then five identical
 * same-process lookups. OS file cache is not flushed. Setup and assertions are not timed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';
import type { ResolvedArtifact } from '../src/resolvers/resolution-output.js';

const jars = 300;
const typesPerJar = 64;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-hierarchy-')));
try {
  process.env.JVMSRC_CACHE_ROOT = path.join(tmp, 'cache');
  process.env.JVMSRC_LOG_DIR = path.join(tmp, 'logs');
  const { computeBuildInputsDigest, readCachedResolution, writeCachedResolution } = await import('../src/cache/index.js');
  const projectRoot = path.join(tmp, 'project');
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'settings.gradle'), "rootProject.name = 'bench'\n");
  fs.writeFileSync(path.join(projectRoot, 'build.gradle'), "plugins { id 'java' }\n");

  const sources = [];
  for (let i = 0; i < jars; i++) {
    const name = `Part${i}`;
    const source = path.join(tmp, `${name}.java`);
    const types = Array.from({ length: typesPerJar - 1 }, (_, n) => `class Type${n}${i > 1 ? ` extends ${name}` : ''} {}`);
    // One sparse cross-JAR hierarchy, including an indirect-only hit in the final artifact.
    let primary = `public class ${name} { public int id() { return ${i}; } }`;
    if (i === 0) primary = `public interface ${name} {}`;
    if (i === 1) primary = `public class ${name} implements bench.p0.Part0 {}`;
    if (i === jars - 1) types[0] = 'class Leaf extends bench.p1.Part1 {}';
    fs.writeFileSync(source, [`package bench.p${i};`, primary, ...types].join('\n'));
    sources.push(source);
  }
  const classes = path.join(tmp, 'classes');
  fs.mkdirSync(classes);
  execFileSync('javac', ['--release', '11', '-g:none', '-d', classes, ...sources], { stdio: 'inherit' });
  const artifacts: ResolvedArtifact[] = [];
  let jarBytes = 0;
  for (let i = 0; i < jars; i++) {
    const pkg = `bench/p${i}`;
    const dir = path.join(classes, pkg);
    const entries = fs.readdirSync(dir).sort();
    assert.equal(entries.length, typesPerJar);
    const bytes = zipSync(Object.fromEntries(entries.map(name => [`${pkg}/${name}`, fs.readFileSync(path.join(dir, name))])));
    const jarPath = path.join(tmp, `part-${i}.jar`);
    fs.writeFileSync(jarPath, bytes);
    jarBytes += bytes.length;
    artifacts.push({ group: 'bench', name: `part-${i}`, version: '1', type: 'jar', origin: 'external', direct: true, jarPath, sourcesJarPath: null });
  }
  const seeded = writeCachedResolution(projectRoot, {
    schemaVersion: '1.1', projectRoot, resolvedAt: new Date().toISOString(), errors: [],
    buildSystem: { type: 'gradle', version: '9.0', wrapper: false },
    modules: [{ name: ':', path: projectRoot, configurations: [{ name: 'compileClasspath', scope: 'compile', artifacts }] }],
  }, computeBuildInputsDigest(projectRoot));
  assert.ok(seeded.ok, JSON.stringify(seeded));
  assert.ok(readCachedResolution(projectRoot).ok, 'Synthetic resolution must be a cache hit');
  console.log(JSON.stringify({ jars, typesPerJar, classes: jars * typesPerJar, jarBytes }));

  const { getHierarchy } = await import('../src/hierarchy/lookup.js');
  const query = { projectRoot, typeName: 'bench.p0.Part0', modulePath: ':', directOnly: false };
  const ms: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const result = await getHierarchy(query);
    ms.push(performance.now() - start);
    if (!result.ok) throw new Error(result.error.message);
    assert.equal(result.kind, 'implementors');
    assert.deepEqual(result.groups.flatMap(g => g.classes), [
      { className: 'bench.p1.Part1', direct: true },
      { className: 'bench.p299.Leaf', direct: false },
    ]);
  }
  const warmMs = ms.slice(1);
  console.log(JSON.stringify({ coldMs: ms[0], warmMs, warmMedianMs: [...warmMs].sort((a, b) => a - b)[2] }));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
