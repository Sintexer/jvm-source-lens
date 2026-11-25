import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveGlobalCacheRoot, writeFileAtomicSameDir } from './cache/paths.js';
import { isPackageName } from './class-search/source-package.js';
import { maxJarBytes } from './extractor/jar-size-guard.js';
import { parsePackagePage } from './package-javadoc-html.js';
import { locatePackagePage } from './package-javadoc-zip.js';

type PackageJavadoc = { entryPath: string; description: string | null; summaries: Record<string, string> };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

// Read exactly the checked size from one descriptor, even if the path is replaced or grows.
async function snapshot(path: string, limit: number) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw Error(`File exceeds Javadoc read limit or is not a regular file: ${path}`);
    const data = Buffer.allocUnsafe(stat.size);
    for (let pos = 0; pos < data.length;) {
      const { bytesRead } = await file.read(data, pos, data.length - pos, pos);
      if (!bytesRead) throw Error('Javadoc file changed while reading');
      pos += bytesRead;
    }
    if ((await file.stat()).size !== data.length) throw Error('Javadoc file changed while reading');
    return data;
  } finally { await file.close(); }
}

export async function readPackageJavadoc(jarPath: string, packageName: string): Promise<PackageJavadoc | null> {
  if (packageName.length > 512 || !isPackageName(packageName)) throw Error('Expected a dotted package name');
  const zip = await snapshot(jarPath, Math.min(maxJarBytes(), 128 * 1024 * 1024));
  const page = locatePackagePage(zip, packageName.replaceAll('.', '/') + '/package-summary.html');
  if (!page) return null;
  const root = resolveGlobalCacheRoot();
  if (!root.ok) throw Error(root.message);
  const dir = join(root.path, 'docs', 'package-v1', digest(zip));
  const path = join(dir, digest(page.entryPath) + '.json');
  try {
    const cached = JSON.parse((await snapshot(path, 1024 * 1024)).toString('utf8'));
    if (cached.entryPath === page.entryPath && (cached.description === null ||
        (typeof cached.description === 'string' && cached.description.length <= 4096)) && cached.summaries &&
        typeof cached.summaries === 'object' && !Array.isArray(cached.summaries)) {
      const entries = Object.entries(cached.summaries);
      if (entries.length <= 256 && entries.every(([k,v]) => k.length <= 256 && typeof v === 'string' && v.length <= 240)) {
        return { entryPath: page.entryPath, description: cached.description, summaries: Object.assign(Object.create(null), cached.summaries) };
      }
    }
  } catch { /* Missing or damaged cache: rebuild from this archive snapshot. */ }
  const result = { entryPath: page.entryPath, ...parsePackagePage(page.expand(), page.entryPath) };
  await mkdir(dir, { recursive: true });
  writeFileAtomicSameDir(path, JSON.stringify(result));
  return result;
}
