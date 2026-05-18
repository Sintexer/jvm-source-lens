import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const BACKUP_COUNT = 3;

function rotateIfNeeded(logRoot: string): void {
  const current = path.join(logRoot, 'current.log');
  let size = 0;
  try {
    size = fs.statSync(current).size;
  } catch {
    return;
  }
  if (size < MAX_BYTES) {
    return;
  }

  const topBackup = path.join(logRoot, `current.log.${BACKUP_COUNT}`);
  try {
    fs.unlinkSync(topBackup);
  } catch {
    /* ignore */
  }

  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    const from = path.join(logRoot, `current.log.${i}`);
    const to = path.join(logRoot, `current.log.${i + 1}`);
    try {
      fs.renameSync(from, to);
    } catch {
      /* ignore */
    }
  }

  try {
    fs.renameSync(current, path.join(logRoot, 'current.log.1'));
  } catch {
    /* ignore */
  }
}

/** Append one NDJSON line; rotates `current.log` when it exceeds 5 MiB (SPEC §6.3). */
export function appendNdjsonLine(logRoot: string, line: string): void {
  try {
    fs.mkdirSync(logRoot, { recursive: true });
    rotateIfNeeded(logRoot);
    const current = path.join(logRoot, 'current.log');
    fs.appendFileSync(current, `${line}\n`, 'utf8');
  } catch {
    /* diagnostic writes must not throw */
  }
}
