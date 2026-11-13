import fs from 'node:fs';
import path from 'node:path';
import { packageNameFromSource } from './source-package.js';

const SOURCE_ROOTS = ['java', 'kotlin', 'scala', 'groovy'] as const;
const SOURCE_EXTS = new Set(['.java', '.kt', '.scala', '.groovy']);
const FILE_STEM = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export type ListedInterprojectSource = {
  fqn: string;
  absolutePath: string;
};

function walkSourceFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const joined = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkSourceFiles(joined, out);
    } else if (ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name))) {
      out.push(joined);
    }
  }
}

function readHead(absFile: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(absFile, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, n);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

/** Package declaration plus the file name. The directory is not the package. */
function fqnFromSourceFile(absFile: string): string | null {
  const stem = path.basename(absFile, path.extname(absFile));
  if (!FILE_STEM.test(stem)) {
    return null;
  }
  const head = readHead(absFile);
  if (head === null) {
    return null;
  }
  const pkg = packageNameFromSource(head);
  return pkg === null ? stem : `${pkg}.${stem}`;
}

function sourceRoots(moduleRoot: string, includeTest: boolean): string[] {
  const scopes = includeTest ? ['main', 'test'] : ['main'];
  const roots: string[] = [];
  for (const scope of scopes) {
    for (const lang of SOURCE_ROOTS) {
      const dir = path.join(moduleRoot, 'src', scope, lang);
      if (fs.existsSync(dir)) {
        roots.push(dir);
      }
    }
  }
  return roots;
}

/**
 * Lists compilation units under `src/{main,test}/{java,kotlin,scala,groovy}`.
 * The FQN is the `package` line plus the file name, so a Kotlin file whose directory
 * differs from its package is still named correctly. A file with no package uses the file name.
 */
export function listFqnsFromInterprojectSources(
  moduleRoot: string,
  includeTest: boolean,
): { ok: true; fqns: string[]; files: ListedInterprojectSource[] } | { ok: false; message: string } {
  const absFiles: string[] = [];
  for (const root of sourceRoots(moduleRoot, includeTest)) {
    walkSourceFiles(root, absFiles);
  }
  const files: ListedInterprojectSource[] = [];
  for (const absolutePath of absFiles) {
    const fqn = fqnFromSourceFile(absolutePath);
    if (fqn !== null) {
      files.push({ fqn, absolutePath });
    }
  }
  return { ok: true, fqns: files.map((file) => file.fqn), files };
}
