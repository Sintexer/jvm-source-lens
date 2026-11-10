import fs from 'node:fs';
import { createHash } from 'node:crypto';

const CHUNK_BYTES = 1024 * 1024;

/** SHA-256 (64 lowercase hex) of a file, read in fixed-size chunks. Throws on I/O errors. */
export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(CHUNK_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK_BYTES, null);
      if (n === 0) {
        break;
      }
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
