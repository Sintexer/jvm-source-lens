import { readFileSync } from 'node:fs';

const EOCD_SIG = 0x06054b50;
const CD_HEADER_SIG = 0x02014b50;

function u32(buf: Buffer, o: number): number {
  return buf.readUInt32LE(o);
}

function u16(buf: Buffer, o: number): number {
  return buf.readUInt16LE(o);
}

function findEocdOffset(buf: Buffer): number {
  const end = buf.length;
  if (end < 22) {
    return -1;
  }
  const min = Math.max(0, end - 65557);
  for (let i = end - 22; i >= min; i--) {
    if (u32(buf, i) === EOCD_SIG) {
      return i;
    }
  }
  return -1;
}

function classEntryToFqn(entryName: string): string | null {
  const n = entryName.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!n.endsWith('.class') || n.includes('META-INF/')) {
    return null;
  }
  const base = n.slice(0, -'.class'.length);
  if (base === 'module-info' || base.endsWith('/module-info')) {
    return null;
  }
  if (base.includes('$')) {
    return null;
  }
  if (!base.includes('/')) {
    return base;
  }
  return base.replaceAll('/', '.');
}

/**
 * Lists top-level `.class` FQNs from a JAR by parsing the ZIP central directory only (no inflate).
 */
export function listFqnsFromJarClassEntries(jarAbsPath: string): { ok: true; fqns: string[] } | { ok: false; message: string } {
  let buf: Buffer;
  try {
    buf = readFileSync(jarAbsPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to read JAR: ${msg}` };
  }

  const eocd = findEocdOffset(buf);
  if (eocd < 0) {
    return { ok: false, message: 'ZIP end-of-central-directory not found' };
  }

  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);
  if (cdOffset + cdSize > buf.length) {
    return { ok: false, message: 'Invalid central directory bounds' };
  }

  const fqns: string[] = [];
  let pos = cdOffset;
  const end = cdOffset + cdSize;

  while (pos + 46 <= end) {
    if (u32(buf, pos) !== CD_HEADER_SIG) {
      return { ok: false, message: 'Invalid central directory signature' };
    }
    const nameLen = u16(buf, pos + 28);
    const extraLen = u16(buf, pos + 30);
    const commentLen = u16(buf, pos + 32);
    const recLen = 46 + nameLen + extraLen + commentLen;
    if (pos + recLen > end) {
      return { ok: false, message: 'Truncated central directory record' };
    }
    const nameBuf = buf.subarray(pos + 46, pos + 46 + nameLen);
    let entryName: string;
    try {
      entryName = nameBuf.toString('utf8');
    } catch {
      entryName = nameBuf.toString('latin1');
    }
    const fqn = classEntryToFqn(entryName);
    if (fqn !== null) {
      fqns.push(fqn);
    }
    pos += recLen;
  }

  if (pos !== end) {
    return { ok: false, message: 'Central directory size mismatch' };
  }

  return { ok: true, fqns };
}
