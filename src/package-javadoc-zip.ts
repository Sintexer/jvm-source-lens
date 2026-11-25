import { inflateRawSync } from 'node:zlib';
import { isPackageName } from './class-search/source-package.js';

const PAGE_BYTES = { package: 1024 * 1024, class: 2 * 1024 * 1024 };
export type JavadocPageKind = keyof typeof PAGE_BYTES;
const invalid = () => Error('Invalid or unsupported Javadoc ZIP');

// ZIP CRC-32 (node:zlib.crc32 is not available on all supported Node 20 releases).
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0);
  return i;
});

/** Walk the classic single-disk ZIP directory without expanding unrelated entries. */
export function locateJavadocPage(zip: Buffer, target: string, kind: JavadocPageKind) {
  const limit = PAGE_BYTES[kind];
  let end = zip.length - 22;
  const first = Math.max(0, end - 65535);
  for (; end >= first; end--) {
    if (zip.readUInt32LE(end) === 0x06054b50 && end + 22 + zip.readUInt16LE(end + 20) === zip.length) break;
  }
  if (end < first || zip.readUInt32LE(end + 4) !== 0) throw invalid();
  const count = zip.readUInt16LE(end + 10);
  const directory = zip.readUInt32LE(end + 16);
  if (directory + zip.readUInt32LE(end + 12) !== end || zip.readUInt16LE(end + 8) !== count) throw invalid();

  let pos = directory;
  let page: { entryPath: string; expand(): string } | null = null;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || zip.readUInt32LE(pos) !== 0x02014b50) throw invalid();
    const nameLen = zip.readUInt16LE(pos + 28);
    const name = zip.subarray(pos + 46, pos + 46 + nameLen);
    const next = pos + 46 + nameLen + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
    const local = zip.readUInt32LE(pos + 42);
    if (next > end || local + 30 > directory || zip.readUInt32LE(local) !== 0x04034b50) throw invalid();
    const flags = zip.readUInt16LE(pos + 8), method = zip.readUInt16LE(pos + 10);
    const crc = zip.readUInt32LE(pos + 16), compressed = zip.readUInt32LE(pos + 20), size = zip.readUInt32LE(pos + 24);
    const start = local + 30 + nameLen + zip.readUInt16LE(local + 28);
    if (zip.readUInt16LE(local + 26) !== nameLen || !zip.subarray(local + 30, local + 30 + nameLen).equals(name) ||
        start + compressed > directory || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method ||
        (!(flags & 8) && (zip.readUInt32LE(local + 14) !== crc || zip.readUInt32LE(local + 18) !== compressed || zip.readUInt32LE(local + 22) !== size))) throw invalid();
    pos = next;
    const entryPath = name.toString('utf8');
    if (entryPath !== target) {
      if (!target.includes('/')) continue; // The unnamed package cannot belong to a named module.
      const prefix = entryPath.indexOf('/');
      if (prefix <= 0 || prefix > 512 || entryPath.slice(prefix + 1) !== target || !isPackageName(entryPath.slice(0, prefix))) continue;
    }
    if (page) throw Error('Ambiguous Javadoc page');
    if (flags & 1 || (method !== 0 && method !== 8)) throw invalid();
    if (size > limit || (method === 0 && compressed > limit)) throw Error('Javadoc page exceeds size limit');
    page = { entryPath, expand() {
      const data = zip.subarray(start, start + compressed);
      const bytes = method === 0 ? data : inflateRawSync(data, { maxOutputLength: limit });
      if (bytes.length !== size) throw invalid();
      let sum = -1;
      for (const b of bytes) sum = (sum >>> 8) ^ crcTable[(sum ^ b) & 255]!;
      if ((~sum >>> 0) !== crc) throw invalid();
      return bytes.toString('utf8');
    } };
  }
  if (pos !== end) throw invalid();
  return page;
}
