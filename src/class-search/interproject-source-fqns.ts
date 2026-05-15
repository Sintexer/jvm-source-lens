import fs from 'node:fs';
import path from 'node:path';

function walkJavaFiles(sourceJavaRoot: string, dir: string, out: Array<{ abs: string; root: string }>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const joined = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkJavaFiles(sourceJavaRoot, joined, out);
    } else if (ent.isFile() && ent.name.endsWith('.java')) {
      out.push({ abs: joined, root: sourceJavaRoot });
    }
  }
}

function javaPathToFqn(absFile: string, javaRoot: string): string | null {
  const rel = path.relative(javaRoot, absFile).split(path.sep).join('/');
  if (!rel.endsWith('.java') || rel.startsWith('..')) {
    return null;
  }
  const withoutExt = rel.slice(0, -'.java'.length);
  return withoutExt.replaceAll('/', '.');
}

/**
 * Lists FQNs from `.java` files under `moduleRoot/src/main/java` and optionally `src/test/java`.
 */
export function listFqnsFromInterprojectSources(
  moduleRoot: string,
  includeTest: boolean,
): { ok: true; fqns: string[] } | { ok: false; message: string } {
  const pairs: Array<{ abs: string; root: string }> = [];
  const main = path.join(moduleRoot, 'src', 'main', 'java');
  if (fs.existsSync(main) && fs.statSync(main).isDirectory()) {
    walkJavaFiles(main, main, pairs);
  }
  if (includeTest) {
    const test = path.join(moduleRoot, 'src', 'test', 'java');
    if (fs.existsSync(test) && fs.statSync(test).isDirectory()) {
      walkJavaFiles(test, test, pairs);
    }
  }
  if (pairs.length === 0) {
    return { ok: true, fqns: [] };
  }

  const fqns: string[] = [];
  for (const { abs, root } of pairs) {
    const fqn = javaPathToFqn(abs, root);
    if (fqn !== null) {
      fqns.push(fqn);
    }
  }

  return { ok: true, fqns };
}
