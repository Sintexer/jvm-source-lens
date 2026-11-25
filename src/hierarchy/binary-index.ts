import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { writeFileAtomicSameDir } from '../cache/paths.js';
import { checkJarSize } from '../extractor/jar-size-guard.js';
import { readHierarchyHeader, scanHierarchyJar, type HierarchyNode } from './scan.js';

const CACHE_LIMIT = 16 * 1024 * 1024;

function readBounded(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw Error(`Expected a regular file of at most ${limit} bytes: ${path}`);
    const bytes = Buffer.allocUnsafe(stat.size);
    for (let pos = 0; pos < bytes.length;) {
      const n = readSync(fd, bytes, pos, bytes.length - pos, pos);
      if (!n) throw Error(`Truncated file: ${path}`);
      pos += n;
    }
    return bytes;
  } finally { closeSync(fd); }
}

// A compact class header can reference the same long constant many times. Bound
// the expanded JSON before stringify; oversized indexes are usable without caching.
function fitsCache(nodes: HierarchyNode[]): boolean {
  let bytes = 96; // envelope, including the digest
  for (const n of nodes) {
    bytes += 80 + 6 * (n.name.length + (n.superclass?.length ?? 0));
    for (const i of n.interfaces) bytes += 3 + 6 * i.length; // worst-case JSON escaping
    if (bytes > CACHE_LIMIT) return false;
  }
  return true;
}

function stamp(path: string): string {
  const s = statSync(path, { bigint: true });
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}

function isNode(n: unknown): n is HierarchyNode {
  return typeof n === 'object' && n !== null && 'name' in n && typeof n.name === 'string' &&
    'superclass' in n && (n.superclass === null || typeof n.superclass === 'string') &&
    'isInterface' in n && typeof n.isInterface === 'boolean' && 'interfaces' in n &&
    Array.isArray(n.interfaces) && n.interfaces.every(i => typeof i === 'string');
}

/** Cache headers, never winning definitions: classpath order belongs to the requesting module. */
export function binaryHeaders(bucket: string, path: string, directory: boolean, refresh: boolean): HierarchyNode[] {
  const files: string[] = [];
  const hash = createHash('sha256').update('loadable-paths-v2\0');
  if (directory) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'META-INF') walk(file);
        else if (entry.isFile() && entry.name.endsWith('.class') && entry.name !== 'module-info.class' && entry.name !== 'package-info.class') files.push(file);
      }
    };
    walk(path);
    for (const file of files.sort()) hash.update(file).update('\0').update(stamp(file)).update('\0');
  } else {
    const size = checkJarSize(path);
    if (!size.ok) throw Error(size.message);
    hash.update(stamp(path));
  }
  const key = hash.digest('hex');
  const dir = join(bucket, 'hierarchy-v1');
  const dest = join(dir, createHash('sha256').update(path).digest('hex') + '.json');
  if (!refresh) {
    try {
      const raw = JSON.parse(readBounded(dest, CACHE_LIMIT).toString('utf8'));
      if (raw.key === key && Array.isArray(raw.nodes) && raw.nodes.every(isNode)) return raw.nodes;
    } catch { /* Missing or damaged optional index. */ }
  }
  const nodes = directory ? [] : scanHierarchyJar(path);
  for (const file of files) {
    const node = readHierarchyHeader(readBounded(file, 8 * 1024 * 1024));
    if (relative(path, file).split(sep).join('/') === node.name.replaceAll('.', '/') + '.class') nodes.push(node);
  }
  if (!fitsCache(nodes)) return nodes;
  mkdirSync(dir, { recursive: true });
  writeFileAtomicSameDir(dest, JSON.stringify({ key, nodes }));
  return nodes;
}
