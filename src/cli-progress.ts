const PREFIX = '[jvmsrc] ';

export type CliProgressReporter = {
  /** Update the current phase label (TTY: same line; otherwise one line per update). */
  update: (message: string) => void;
  /** End the current phase line (TTY: newline if something was written in-place). */
  finishPhase: () => void;
  /** Call once at CLI handler exit so a partial TTY line is not left hanging. */
  finalize: () => void;
};

/**
 * stderr-only progress; no-ops when `enabled` is false.
 */
export function createCliProgressReporter(enabled: boolean): CliProgressReporter {
  if (!enabled) {
    const noop = (): void => {};
    return { update: noop, finishPhase: noop, finalize: noop };
  }

  let ttyDirty = false;

  return {
    update(message: string) {
      const line = `${PREFIX}${message}`;
      if (process.stderr.isTTY) {
        process.stderr.write(`\r\x1b[K${line}`);
        ttyDirty = true;
      } else {
        console.error(line);
      }
    },
    finishPhase() {
      if (process.stderr.isTTY && ttyDirty) {
        process.stderr.write('\n');
        ttyDirty = false;
      }
    },
    finalize() {
      if (process.stderr.isTTY && ttyDirty) {
        process.stderr.write('\n');
        ttyDirty = false;
      }
    },
  };
}
