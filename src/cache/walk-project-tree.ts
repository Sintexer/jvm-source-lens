import fs from 'node:fs';
import path from 'node:path';

export const COMMON_SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'build',
  'node_modules',
  '.git',
  'dist',
  'out',
  'bin',
  '.idea',
  '.vscode',
  'coverage',
  '__pycache__',
  '.svn',
]);

export type WalkProjectTreeOptions = {
  /** Resolver-specific directories to skip in addition to `COMMON_SKIP_DIR_NAMES`. */
  extraSkipDirs?: ReadonlySet<string>;
  /** Returns `true` when the visited regular file should be collected. */
  includeFile: (fileName: string, relativePosixPath: string) => boolean;
};

/**
 * Symlink-safe recursive directory walk under `rootAbs`.
 * Never follows symlinked files or directories (prevents loops and out-of-tree reads).
 * Returns relative POSIX-style paths in traversal order.
 */
export function walkProjectTree(rootAbs: string, options: WalkProjectTreeOptions): string[] {
  const collected: string[] = [];
  const extraSkip = options.extraSkipDirs;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) {
        continue;
      }
      const joined = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (COMMON_SKIP_DIR_NAMES.has(ent.name) || extraSkip?.has(ent.name)) {
          continue;
        }
        walk(joined);
      } else if (ent.isFile()) {
        const relPosix = path.relative(rootAbs, joined).split(path.sep).join('/');
        if (options.includeFile(ent.name, relPosix)) {
          collected.push(relPosix);
        }
      }
    }
  }

  walk(rootAbs);
  return collected;
}
