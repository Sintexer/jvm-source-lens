import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LogRootResult = { ok: true; path: string } | { ok: false; message: string };

/**
 * Machine-local log root (SPEC §6.3). Override: **`JVMSRC_LOG_DIR`** — absolute path only.
 */
export function resolveGlobalLogRoot(): LogRootResult {
  const raw = process.env.JVMSRC_LOG_DIR?.trim();
  if (raw) {
    if (!path.isAbsolute(raw)) {
      return {
        ok: false,
        message:
          'JVMSRC_LOG_DIR must be set to an absolute path; relative paths are not allowed (they would depend on the process working directory).',
      };
    }
    return { ok: true, path: path.normalize(raw) };
  }

  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return { ok: true, path: path.join(home, 'Library', 'Logs', 'jvmsrc') };
  }

  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const base = local && local.length > 0 ? local : path.join(home, 'AppData', 'Local');
    return { ok: true, path: path.join(base, 'jvmsrc', 'Logs') };
  }

  const xdgState = process.env.XDG_STATE_HOME?.trim();
  const stateBase =
    xdgState && xdgState.length > 0 ? xdgState : path.join(home, '.local', 'state');
  return { ok: true, path: path.join(stateBase, 'jvmsrc') };
}

export function ensureLogTree(logRoot: string): void {
  fs.mkdirSync(path.join(logRoot, 'diagnostics'), { recursive: true });
}
