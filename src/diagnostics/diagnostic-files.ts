import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticRecord } from './diagnostic-record.js';
import { DIAGNOSTIC_FILE_SEVERITIES, type FailureSeverity } from './failure-severity.js';

const MAX_DIAGNOSTIC_FILES = 50;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function listDiagnosticFiles(diagnosticsDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(diagnosticsDir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.json')).map((n) => path.join(diagnosticsDir, n));
}

function pruneByAge(diagnosticsDir: string, now: number): void {
  for (const file of listDiagnosticFiles(diagnosticsDir)) {
    try {
      const st = fs.statSync(file);
      if (now - st.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(file);
      }
    } catch {
      /* ignore */
    }
  }
}

function pruneByCount(diagnosticsDir: string): void {
  const files = listDiagnosticFiles(diagnosticsDir);
  if (files.length <= MAX_DIAGNOSTIC_FILES) {
    return;
  }
  const withMtime = files.map((f) => {
    try {
      return { f, m: fs.statSync(f).mtimeMs };
    } catch {
      return { f, m: 0 };
    }
  });
  withMtime.sort((a, b) => a.m - b.m);
  const drop = withMtime.length - MAX_DIAGNOSTIC_FILES;
  for (let i = 0; i < drop; i++) {
    try {
      fs.unlinkSync(withMtime[i]!.f);
    } catch {
      /* ignore */
    }
  }
}

export function maybeWriteDiagnosticFile(
  logRoot: string,
  severity: FailureSeverity,
  record: DiagnosticRecord,
): boolean {
  if (!DIAGNOSTIC_FILE_SEVERITIES.has(severity)) {
    return false;
  }
  const diagnosticsDir = path.join(logRoot, 'diagnostics');
  try {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    const now = Date.now();
    pruneByAge(diagnosticsDir, now);
    const dest = path.join(diagnosticsDir, `${record.id}.json`);
    const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, dest);
    pruneByCount(diagnosticsDir);
    return true;
  } catch {
    return false;
  }
}
