import { statSync } from 'node:fs';
import { parsePositiveIntEnv } from '../config/env-int.js';

/** Default cap on archives read fully into memory. Override with `JVMSRC_MAX_JAR_BYTES`. */
export const DEFAULT_MAX_JAR_BYTES = 500 * 1024 * 1024;

export function maxJarBytes(): number {
  return parsePositiveIntEnv('JVMSRC_MAX_JAR_BYTES', DEFAULT_MAX_JAR_BYTES);
}

export type JarSizeCheck = { ok: true } | { ok: false; message: string };

/**
 * Refuses archives above {@link maxJarBytes} before they are read into memory.
 * A failed `stat` passes; the following read reports the real I/O error.
 */
export function checkJarSize(jarAbsPath: string): JarSizeCheck {
  let size: number;
  try {
    size = statSync(jarAbsPath).size;
  } catch {
    return { ok: true };
  }
  const limit = maxJarBytes();
  if (size <= limit) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `Archive is ${size} bytes; limit is ${limit} (JVMSRC_MAX_JAR_BYTES)`,
  };
}
