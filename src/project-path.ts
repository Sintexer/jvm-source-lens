import fs from 'node:fs';
import path from 'node:path';

export type ProjectRootResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export function resolveProjectRoot(input: string): ProjectRootResult {
  const resolved = path.resolve(input);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, message: `Project path does not exist: ${resolved}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, message: `Project path is not a directory: ${resolved}` };
  }
  return { ok: true, path: resolved };
}
