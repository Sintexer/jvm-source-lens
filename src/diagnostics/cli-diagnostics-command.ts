import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import type { FailureSeverity } from './failure-severity.js';
import { resolveGlobalLogRoot } from './log-root.js';
import type { DiagnosticRecord } from './diagnostic-record.js';

function logRootOrExit(): string {
  const r = resolveGlobalLogRoot();
  if (!r.ok) {
    console.error(r.message);
    process.exitCode = 1;
    process.exit();
  }
  return r.path;
}

function parseRecordLine(line: string): DiagnosticRecord | null {
  const t = line.trim();
  if (t.length === 0) {
    return null;
  }
  try {
    return JSON.parse(t) as DiagnosticRecord;
  } catch {
    return null;
  }
}

function readAllNdjsonRecords(logRoot: string): DiagnosticRecord[] {
  const files = ['current.log', 'current.log.1', 'current.log.2', 'current.log.3'].map((n) =>
    path.join(logRoot, n),
  );
  const out: DiagnosticRecord[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const rec = parseRecordLine(line);
      if (rec) {
        out.push(rec);
      }
    }
  }
  return out;
}

function parseOlderThanMs(spec: string): number | null {
  const s = spec.trim();
  const m = /^(\d+)(d|h|m|s)$/i.exec(s);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  const u = m[2]!.toLowerCase();
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  const mult =
    u === 'd' ? 86400_000 : u === 'h' ? 3600_000 : u === 'm' ? 60_000 : 1000;
  return n * mult;
}

export function registerDiagnosticsCli(program: Command): void {
  const diag = new Command('diagnostics').description(
    'List, show, or clear structured failure logs (see SPEC / JVMSRC_LOG_DIR)',
  );

  diag
    .command('list')
    .description('Recent diagnostic entries from rolling NDJSON log(s)')
    .option('--severity <name>', 'Filter by FailureSeverity (e.g. resolver_fail)')
    .action((opts: { severity?: string }) => {
      const logRoot = logRootOrExit();
      let records = readAllNdjsonRecords(logRoot);
      if (opts.severity) {
        const sev = opts.severity as FailureSeverity;
        records = records.filter((r) => r.severity === sev);
      }
      records.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
      const short = (id: string) => id.replace(/-/g, '').slice(0, 8);
      for (const r of records) {
        console.log(`${r.timestamp}\t${r.severity}\t${r.errorCode}\t${short(r.id)}\t${r.operation}`);
      }
    });

  diag
    .command('show')
    .description('Print one diagnostic record by id (full UUID or 8+ hex prefix)')
    .argument('<id>', 'Diagnostic id')
    .action((idArg: string) => {
      const logRoot = logRootOrExit();
      const idLower = idArg.trim().toLowerCase();
      const jsonDir = path.join(logRoot, 'diagnostics');
      let fullPath: string | null = null;
      try {
        const names = fs.readdirSync(jsonDir);
        const match = names.find((n) => n.endsWith('.json') && n.toLowerCase().startsWith(idLower));
        if (match) {
          fullPath = path.join(jsonDir, match);
        }
      } catch {
        /* no dir */
      }
      if (fullPath && fs.existsSync(fullPath)) {
        process.stdout.write(fs.readFileSync(fullPath, 'utf8'));
        return;
      }
      const records = readAllNdjsonRecords(logRoot);
      const needle = idLower.replace(/-/g, '');
      const hit =
        records.find((r) => r.id.replace(/-/g, '').startsWith(needle)) ??
        records.find((r) => r.id.toLowerCase().startsWith(idLower));
      if (hit) {
        console.log(JSON.stringify(hit, null, 2));
        return;
      }
      console.error('No diagnostic record found for id.');
      process.exitCode = 1;
    });

  diag
    .command('clear')
    .description('Remove old detailed diagnostic JSON files (and rotated logs when aged out)')
    .requiredOption('--older-than <dur>', 'Age threshold, e.g. 7d, 24h, 30m')
    .action((opts: { olderThan: string }) => {
      const logRoot = logRootOrExit();
      const ms = parseOlderThanMs(opts.olderThan);
      if (ms == null) {
        console.error('Invalid --older-than (use e.g. 7d, 24h, 30m).');
        process.exitCode = 1;
        return;
      }
      const cutoff = Date.now() - ms;
      const jsonDir = path.join(logRoot, 'diagnostics');
      let removed = 0;
      try {
        for (const n of fs.readdirSync(jsonDir)) {
          if (!n.endsWith('.json')) {
            continue;
          }
          const p = path.join(jsonDir, n);
          try {
            const st = fs.statSync(p);
            if (st.mtimeMs < cutoff) {
              fs.unlinkSync(p);
              removed++;
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      for (const n of ['current.log.1', 'current.log.2', 'current.log.3']) {
        const p = path.join(logRoot, n);
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs < cutoff) {
            fs.unlinkSync(p);
            removed++;
          }
        } catch {
          /* ignore */
        }
      }
      console.error(`Removed ${removed} aged file(s) under ${logRoot}.`);
    });

  program.addCommand(diag);
}
