/**
 * Compiles resources/maven-analyzer-src/ into resources/maven-analyzer.jar (--release 8).
 * Run: bun run setup:maven-analyzer
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';

type CompileDep = {
  mavenRelPath: string;
  sha256: string;
};

const COMPILE_DEPS: readonly CompileDep[] = [
  {
    mavenRelPath: 'org/apache/maven/maven-core/3.9.9/maven-core-3.9.9.jar',
    sha256: '7fab37fc6044f20ae004376ab8414373636cf51e26ad0b1efa6b3f1cd2bec503',
  },
  {
    mavenRelPath: 'org/apache/maven/maven-model/3.9.9/maven-model-3.9.9.jar',
    sha256: '8f59b0a16fe9c933be749a60ae0705a0cb337bb5abaf38801b40b740ff775727',
  },
  {
    mavenRelPath: 'org/apache/maven/maven-artifact/3.9.9/maven-artifact-3.9.9.jar',
    sha256: '30f015d1c1a393e19c18cd4f43532089c36d4ca328608ce3dda78b74d3d31515',
  },
  {
    mavenRelPath: 'org/apache/maven/resolver/maven-resolver-api/1.9.22/maven-resolver-api-1.9.22.jar',
    sha256: '63f5f665e44a09ef55463b3b91fda0b78ff07dd24b1060d56e79c10b6e32cbfb',
  },
  {
    mavenRelPath: 'org/apache/maven/resolver/maven-resolver-util/1.9.22/maven-resolver-util-1.9.22.jar',
    sha256: '4aaea1584c39294ca926fc474723d9684473609ef4490c4eb169d6ea7daca6b5',
  },
  {
    mavenRelPath: 'javax/inject/javax.inject/1/javax.inject-1.jar',
    sha256: '91c77044a50c481636c32d916fd89c9118a72195390452c81065080f957de7ff',
  },
];

const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2';
const DETERMINISTIC_MTIME = new Date('2020-01-01T00:00:00Z');

function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function fileMatchesSha256(filePath: string, expected: string): boolean {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return false;
    }
    return sha256Hex(fs.readFileSync(filePath)) === expected;
  } catch {
    return false;
  }
}

async function resolveCompileDep(dep: CompileDep, cacheDir: string): Promise<string> {
  const fileName = path.posix.basename(dep.mavenRelPath);
  const localM2Candidate = path.join(os.homedir(), '.m2', 'repository', ...dep.mavenRelPath.split('/'));
  if (fileMatchesSha256(localM2Candidate, dep.sha256)) {
    return localM2Candidate;
  }

  for (const envVar of ['MAVEN_HOME', 'M2_HOME']) {
    const home = process.env[envVar]?.trim();
    if (home) {
      const candidate = path.join(home, 'lib', fileName);
      if (fileMatchesSha256(candidate, dep.sha256)) {
        return candidate;
      }
    }
  }

  const cached = path.join(cacheDir, fileName);
  if (fileMatchesSha256(cached, dep.sha256)) {
    return cached;
  }

  const url = `${MAVEN_CENTRAL}/${dep.mavenRelPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const actual = sha256Hex(buf);
  if (actual !== dep.sha256) {
    throw new Error(`SHA-256 mismatch for ${url}: expected ${dep.sha256}, got ${actual}`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, buf);
  return cached;
}

function resolveJavacExecutable(): string {
  const binName = process.platform === 'win32' ? 'javac.exe' : 'javac';
  const javaHome = process.env.JAVA_HOME?.trim();
  if (javaHome) {
    const candidate = path.join(javaHome, 'bin', binName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return binName;
}

function collectFilesPosix(baseDir: string, currentDir = baseDir): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectFilesPosix(baseDir, full));
    } else if (ent.isFile()) {
      out.push(path.relative(baseDir, full).split(path.sep).join('/'));
    }
  }
  return out;
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const srcRoot = path.join(root, 'resources', 'maven-analyzer-src');
  const javaSrc = path.join(srcRoot, 'jvmsrc', 'maven', 'JvmsrcMavenAnalyzer.java');
  const componentsXml = path.join(srcRoot, 'META-INF', 'plexus', 'components.xml');
  const destJar = path.join(root, 'resources', 'maven-analyzer.jar');

  const depsCache = path.join(os.tmpdir(), 'jvmsrc-maven-compile-deps-v1');
  const cpEntries: string[] = [];
  for (const dep of COMPILE_DEPS) {
    cpEntries.push(await resolveCompileDep(dep, depsCache));
  }

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-maven-analyzer-classes-'));
  try {
    const javac = resolveJavacExecutable();
    const res = spawnSync(
      javac,
      ['--release', '8', '-cp', cpEntries.join(path.delimiter), '-d', tmpOut, javaSrc],
      { encoding: 'utf8' },
    );
    if (res.error) {
      throw new Error(`Failed to invoke ${javac}: ${res.error.message}`);
    }
    if (res.status !== 0) {
      throw new Error(`javac exited with ${res.status}:\n${res.stderr || res.stdout}`);
    }

    const metaDest = path.join(tmpOut, 'META-INF', 'plexus', 'components.xml');
    fs.mkdirSync(path.dirname(metaDest), { recursive: true });
    fs.copyFileSync(componentsXml, metaDest);

    const relEntries = collectFilesPosix(tmpOut).sort((a, b) => a.localeCompare(b));
    const archive: Zippable = {};
    archive['META-INF/MANIFEST.MF'] = [
      new TextEncoder().encode('Manifest-Version: 1.0\r\n\r\n'),
      { mtime: DETERMINISTIC_MTIME, level: 9 },
    ];
    for (const rel of relEntries) {
      archive[rel] = [
        new Uint8Array(fs.readFileSync(path.join(tmpOut, ...rel.split('/')))),
        { mtime: DETERMINISTIC_MTIME, level: 9 },
      ];
    }

    const jarBytes = zipSync(archive);
    fs.mkdirSync(path.dirname(destJar), { recursive: true });
    fs.writeFileSync(destJar, jarBytes);
    console.log(`Wrote ${destJar} (${jarBytes.byteLength} bytes).`);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
}

await main();
