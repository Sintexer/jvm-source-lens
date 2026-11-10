import { Worker } from 'node:worker_threads';
import { parsePositiveIntEnv } from './config/env-int.js';

/** Default wall-clock cap for one regex scan. Override with `JVMSRC_REGEX_TIMEOUT_MS`. */
export const DEFAULT_REGEX_TIMEOUT_MS = 2000;

export function regexTimeoutMs(): number {
  return parsePositiveIntEnv('JVMSRC_REGEX_TIMEOUT_MS', DEFAULT_REGEX_TIMEOUT_MS);
}

export type RegexMatchRequest = {
  source: string;
  pattern: string;
  maxHits: number;
  maxIterations: number;
};

export type RegexMatchOutcome =
  | { ok: true; ranges: Array<[number, number]>; totalMatches: number; capped: boolean }
  | { ok: false; reason: 'timeout'; timeoutMs: number }
  | { ok: false; reason: 'error'; message: string };

// Inline CommonJS so the bundle needs no extra entry point; eval workers are CommonJS on Node and Bun.
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (req) => {
  try {
    const re = new RegExp(req.pattern, 'g');
    const ranges = [];
    let totalMatches = 0;
    let iterations = 0;
    let capped = false;
    for (;;) {
      if (iterations >= req.maxIterations) {
        capped = true;
        break;
      }
      const m = re.exec(req.source);
      if (!m) {
        break;
      }
      iterations++;
      const at = m.index;
      const len = m[0].length;
      if (len === 0) {
        if (re.lastIndex === at) {
          re.lastIndex = at + 1;
        }
        continue;
      }
      totalMatches++;
      if (ranges.length < req.maxHits) {
        ranges.push([at, at + len]);
      }
    }
    parentPort.postMessage({ ok: true, ranges, totalMatches, capped });
  } catch (e) {
    parentPort.postMessage({ ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) });
  }
});
`;

/**
 * Runs regex scans in a worker thread with a wall-clock deadline, so a catastrophic
 * pattern cannot block the MCP/CLI event loop. One request at a time; the worker is
 * reused across requests and replaced after a timeout. Call {@link close} when done.
 */
export class RegexMatchRunner {
  private worker: Worker | null = null;

  constructor(private readonly timeoutMs: number = regexTimeoutMs()) {}

  match(req: RegexMatchRequest): Promise<RegexMatchOutcome> {
    const worker = this.ensureWorker();
    return new Promise((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
      };
      const onMessage = (msg: RegexMatchOutcome): void => {
        cleanup();
        resolve(msg);
      };
      const onError = (e: Error): void => {
        cleanup();
        this.discard();
        resolve({ ok: false, reason: 'error', message: e.message });
      };
      const timer = setTimeout(() => {
        cleanup();
        this.discard();
        resolve({ ok: false, reason: 'timeout', timeoutMs: this.timeoutMs });
      }, this.timeoutMs);
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.postMessage(req);
    });
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w !== null) {
      await w.terminate();
    }
  }

  private ensureWorker(): Worker {
    if (this.worker === null) {
      this.worker = new Worker(WORKER_SOURCE, { eval: true });
      // An idle worker must not keep the CLI process alive; the request timer does that.
      this.worker.unref();
    }
    return this.worker;
  }

  private discard(): void {
    const w = this.worker;
    this.worker = null;
    if (w !== null) {
      void w.terminate();
    }
  }
}
