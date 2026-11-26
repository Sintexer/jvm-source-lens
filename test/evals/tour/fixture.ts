/**
 * Fixture helpers for the tour demo. Invented `acme:*` libraries (see synthetic/) are compiled into a
 * local Maven repo, so no model can know their APIs from training data. `prepareProject` copies the
 * Gradle project and points its `@TOUR_REPO@` token at that repo.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = import.meta.dir;
export const repoDir = path.join(here, '.repo');
const synthetic = path.join(here, 'synthetic');

function sh(cmd: string[]): void {
  const r = Bun.spawnSync(cmd);
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed: ${r.stderr.toString()}`);
}

function pom(artifact: string, version: string, deps: string[]): string {
  const dependencies = deps
    .map((d) => {
      const [g, a, v] = d.split(':');
      return `    <dependency><groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version></dependency>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>acme</groupId><artifactId>${artifact}</artifactId><version>${version}</version>
  <dependencies>
${dependencies}
  </dependencies>
</project>
`;
}

function javaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? javaFiles(path.join(dir, e.name)) : e.name.endsWith('.java') ? [path.join(dir, e.name)] : [],
  );
}

/** Rebuilds the local repo from synthetic/ (cheap: about 10 small jars). */
export function buildRepo(): void {
  rmSync(repoDir, { recursive: true, force: true });
  const libs = readdirSync(synthetic).flatMap((artifact) =>
    readdirSync(path.join(synthetic, artifact)).map((version) => ({ artifact, version })),
  );
  for (const { artifact, version } of libs) {
    const root = path.join(synthetic, artifact, version);
    const meta = JSON.parse(readFileSync(path.join(root, 'lib.json'), 'utf8')) as { sources: boolean; deps: string[] };
    const out = path.join(repoDir, 'acme', artifact, version);
    mkdirSync(out, { recursive: true });
    // Classpath for compiling: jars of already-built dependency libs (ledger before reports).
    const classes = mkdtempSync(path.join(tmpdir(), 'tour-synth-'));
    const depJars = meta.deps.map((d) => {
      const [, a, v] = d.split(':');
      return path.join(repoDir, 'acme', a!, v!, `${a}-${v}.jar`);
    });
    for (const j of depJars) if (!existsSync(j)) throw new Error(`build ${j} first (order libs by dependency)`);
    sh(['javac', '--release', '17', '-d', classes, ...(depJars.length ? ['-cp', depJars.join(':')] : []), ...javaFiles(path.join(root, 'src'))]);
    sh(['jar', 'cf', path.join(out, `${artifact}-${version}.jar`), '-C', classes, '.']);
    if (meta.sources) sh(['jar', 'cf', path.join(out, `${artifact}-${version}-sources.jar`), '-C', path.join(root, 'src'), '.']);
    writeFileSync(path.join(out, `${artifact}-${version}.pom`), pom(artifact, version, meta.deps));
  }
}

/** Builds the repo when missing. */
export function ensureRepo(): void {
  if (!existsSync(path.join(repoDir, 'acme', 'reports', '1.2.0', 'reports-1.2.0.jar'))) buildRepo();
}

/**
 * Copies the Gradle project to `dest` and a private copy of the local repo next to it (`../repo`), then
 * fills in the repo path. The agent must not be able to walk from the repo into this checkout, where the
 * invented libraries' sources and the answer key live.
 */
export function prepareProject(dest: string): void {
  cpSync(path.join(here, 'project'), dest, { recursive: true });
  const repoCopy = path.join(path.dirname(dest), 'repo');
  cpSync(repoDir, repoCopy, { recursive: true });
  const file = path.join(dest, 'app/build.gradle');
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('@TOUR_REPO@', repoCopy));
}
