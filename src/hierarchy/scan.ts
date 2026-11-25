import { isUtf8 } from 'node:buffer';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { maxJarBytes } from '../extractor/jar-size-guard.js';

export type HierarchyNode = { name: string; superclass: string | null; interfaces: string[]; isInterface: boolean };

const CLASS_LIMIT = 8 * 1024 * 1024;
const TOTAL_LIMIT = 64 * 1024 * 1024;
const badClass = (why: string) => Error(`Invalid class header: ${why}`);

// CONSTANT_Utf8 encodes UTF-16 code units, including surrogate pairs, not Unicode scalars.
function binaryName(bytes: Buffer): string {
  let name = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++]!;
    let c = a;
    if (a >= 0xc2 && a < 0xe0) {
      const b = bytes[i++];
      if (b === undefined || (b & 0xc0) !== 0x80) throw badClass('invalid modified UTF-8');
      c = ((a & 31) << 6) | (b & 63);
    } else if (a >= 0xe0 && a < 0xf0) {
      const b = bytes[i++], d = bytes[i++];
      if (b === undefined || d === undefined || (b & 0xc0) !== 0x80 || (d & 0xc0) !== 0x80 || (a === 0xe0 && b < 0xa0)) {
        throw badClass('invalid modified UTF-8');
      }
      c = ((a & 15) << 12) | ((b & 63) << 6) | (d & 63);
    } else if (a === 0 || a >= 0x80) throw badClass('invalid class name encoding');
    name += String.fromCharCode(c);
  }
  if (!name || /[.;\[]|^\/|\/$|\/\//.test(name)) throw badClass('invalid internal class name');
  return name.replaceAll('/', '.');
}

export function readHierarchyHeader(bytes: Uint8Array): HierarchyNode {
  if (bytes.length > CLASS_LIMIT) throw Error(`Class exceeds ${CLASS_LIMIT} byte limit`);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const take = (n: number) => {
    const at = pos;
    pos += n;
    if (pos > buf.length) throw badClass('truncated');
    return at;
  };
  const u2 = () => buf.readUInt16BE(take(2));
  if (buf.readUInt32BE(take(4)) !== 0xcafebabe) throw badClass('bad magic');
  take(4); // minor and major version
  const count = u2();
  if (!count || count - 1 > buf.length - pos) throw badClass('invalid constant pool count');
  const offsets = new Uint32Array(count);
  for (let i = 1; i < count; i++) {
    offsets[i] = pos;
    const tag = buf[take(1)];
    switch (tag) {
      case 1: take(u2()); break;
      case 7: case 8: case 16: case 19: case 20: take(2); break;
      case 15: take(3); break;
      case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18: take(4); break;
      case 5: case 6:
        if (++i >= count) throw badClass('missing second slot for long/double');
        take(8); break;
      default: throw badClass(`unknown constant pool tag ${tag}`);
    }
  }
  const names = new Map<number, string>();
  const className = (index: number) => {
    const cls = offsets[index];
    if (!cls || buf[cls] !== 7) throw badClass(`expected Class at #${index}`);
    const utf = offsets[buf.readUInt16BE(cls + 1)];
    if (!utf || buf[utf] !== 1) throw badClass(`expected Utf8 for Class #${index}`);
    let name = names.get(utf);
    if (name === undefined) {
      name = binaryName(buf.subarray(utf + 3, utf + 3 + buf.readUInt16BE(utf + 1)));
      names.set(utf, name);
    }
    return name;
  };
  const flags = u2();
  const isInterface = !!(flags & 0x0200);
  const name = className(u2());
  const parent = u2();
  const superclass = parent ? className(parent) : null;
  if ((isInterface && superclass !== 'java.lang.Object') || (!parent && name !== 'java.lang.Object' && !(flags & 0x8000))) {
    throw badClass('invalid superclass');
  }
  const interfaces: string[] = [];
  for (let n = u2(); n > 0; n--) interfaces.push(className(u2()));
  return { name, superclass: isInterface ? null : superclass, interfaces, isInterface };
}

// CRC32 is not built into early Node 20 versions.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n;
});

function scanZip(zip: Buffer): HierarchyNode[] {
  const invalid = (why: string) => Error(`Invalid or unsupported ZIP: ${why}`);
  const u16 = (at: number) => zip.readUInt16LE(at);
  const u32 = (at: number) => zip.readUInt32LE(at);
  let end = zip.length - 22;
  const first = Math.max(0, end - 65535);
  for (; end >= first; end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === zip.length) break;
  }
  if (end < first) throw invalid('missing end of central directory');
  const directory = u32(end + 16), count = u16(end + 10);
  if (u32(end + 4) || u16(end + 8) !== count || directory + u32(end + 12) !== end) {
    throw invalid('not a classic single-disk central directory');
  }
  let pos = directory, total = 0;
  const nodes = new Map<string, HierarchyNode>();
  for (let i = 0; i < count; i++) {
    const central = pos;
    if (central + 46 > end || u32(central) !== 0x02014b50) throw invalid('bad central directory record');
    const nameLen = u16(central + 28);
    pos += 46 + nameLen + u16(central + 30) + u16(central + 32);
    if (pos > end || u16(central + 34)) throw invalid('invalid directory record bounds or disk');
    const name = zip.subarray(central + 46, central + 46 + nameLen);
    const local = u32(central + 42), flags = u16(central + 8), method = u16(central + 10);
    const crc = u32(central + 16), packed = u32(central + 20), size = u32(central + 24);
    if (local + 30 > directory || u32(local) !== 0x04034b50) throw invalid('bad local header');
    const start = local + 30 + nameLen + u16(local + 28);
    if (start + packed > directory || nameLen !== u16(local + 26) || !zip.subarray(local + 30, local + 30 + nameLen).equals(name) ||
        flags !== u16(local + 6) || method !== u16(local + 8) ||
        (!(flags & 8) && (crc !== u32(local + 14) || packed !== u32(local + 18) || size !== u32(local + 22)))) {
      throw invalid('inconsistent local entry');
    }
    if (flags & 8) {
      const at = start + packed;
      const matches = (p: number) => p + 12 <= directory && u32(p) === crc && u32(p + 4) === packed && u32(p + 8) === size;
      if (!matches(at) && !(at + 16 <= directory && u32(at) === 0x08074b50 && matches(at + 4))) {
        throw invalid('inconsistent data descriptor');
      }
    }
    // Base entries only. Do not normalize paths: a class loader requests an exact entry name.
    const path = name.toString('utf8');
    if (!path.endsWith('.class') || path.includes('META-INF/') || /(?:^|\/)(?:module|package)-info\.class$/.test(path) || !isUtf8(name)) continue;
    if (flags & ~0x080e || (method !== 0 && method !== 8)) throw invalid(`unsupported compression or flags for ${path}`);
    if (size > CLASS_LIMIT) throw Error(`${path} exceeds class size limit (${CLASS_LIMIT})`);
    if (total + size > TOTAL_LIMIT) throw Error(`Aggregate class data exceeds ${TOTAL_LIMIT} byte limit`);
    const data = zip.subarray(start, start + packed);
    let bytes: Buffer;
    try {
      bytes = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, size) });
    } catch (e) {
      throw invalid(`cannot inflate ${path} within its declared size (${size}): ${e}`);
    }
    if (bytes.length !== size) throw invalid(`size mismatch for ${path}`);
    let sum = -1;
    for (const byte of bytes) sum = (sum >>> 8) ^ crcTable[(sum ^ byte) & 255]!;
    if ((~sum >>> 0) !== crc) throw invalid(`CRC mismatch for ${path}`);
    try {
      const node = readHierarchyHeader(bytes);
      // The last directory entry for a path wins, even if its class has the wrong name.
      if (path === node.name.replaceAll('.', '/') + '.class') nodes.set(path, node);
      else nodes.delete(path);
    } catch (e) {
      throw Error(`${path}: ${e}`);
    }
    total += bytes.length;
  }
  if (pos !== end) throw invalid('central directory size mismatch');
  return [...nodes.values()];
}

export function scanHierarchyJar(jarPath: string): HierarchyNode[] {
  const fd = openSync(jarPath, 'r');
  try {
    // Size and read the same file descriptor. Concurrent growth never enlarges the allocation.
    const stat = fstatSync(fd), limit = maxJarBytes();
    if (!stat.isFile()) throw Error('expected a regular JAR file');
    if (stat.size > limit) throw Error(`Archive is ${stat.size} bytes; limit is ${limit} (JVMSRC_MAX_JAR_BYTES)`);
    const zip = Buffer.allocUnsafe(stat.size);
    for (let pos = 0; pos < zip.length;) {
      const n = readSync(fd, zip, pos, zip.length - pos, pos);
      if (!n) throw Error('truncated JAR');
      pos += n;
    }
    return scanZip(zip);
  } catch (e) {
    throw Error(`${jarPath}: ${e}`);
  } finally {
    closeSync(fd);
  }
}
