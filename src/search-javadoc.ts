import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { searchClassSourceText, type ClassSourceTextSearchHit } from './class-source-text-search.js';
import type { ClassSourceError } from './extractor/class-source-types.js';
import { checkJarSize } from './extractor/jar-size-guard.js';
import { parseElements, plainLines } from './package-javadoc-html.js';

const PAGE_BYTES = 2 * 1024 * 1024;
const TOTAL_BYTES = 32 * 1024 * 1024;
const TEXT_CHARS = 512 * 1024;

export type JavadocSearchHitClass = { className: string; sourceAvailable: false; totalMatches: number; hits: ClassSourceTextSearchHit[] };
export type JavadocSearchResult =
  | { ok: true; classesScanned: number; totalMatches: number; hitCount: number; truncated: boolean; hits: JavadocSearchHitClass[] }
  | { ok: false; error: ClassSourceError };

const zipError = (jarPath: string, message: string): JavadocSearchResult =>
  ({ ok: false, error: { code: 'ZIP_READ_ERROR', message, jarPath, entryRelPath: '' } });

/**
 * Literal text search over the Javadoc class pages of the given binary class names.
 * Only `<pkg>/<Outer.Inner>.html` (optionally under a module directory) is read; other pages are never expanded.
 * HTML is untrusted: scripts and styles are dropped, links are never followed, expanded size is bounded.
 */
export async function searchJavadocJar(
  jarPath: string,
  classNames: readonly string[],
  opts: { query: string; regex?: boolean; contextLines?: number; maxHits?: number; maxClasses?: number },
): Promise<JavadocSearchResult> {
  if (opts.regex) {
    return { ok: false, error: { code: 'FIND_QUERY_INVALID', message: 'docs search is literal only; omit regex.' } };
  }
  // `a.b.Outer$Inner` → `a/b/Outer.Inner.html`.
  const wanted = new Map<string, string>();
  for (const fqn of classNames.slice(0, opts.maxClasses ?? 500)) {
    wanted.set(fqn.replaceAll('.', '/').replaceAll('$', '.') + '.html', fqn);
  }
  const size = checkJarSize(jarPath);
  if (!size.ok) return zipError(jarPath, size.message);
  let files: Record<string, Uint8Array>;
  try {
    const raw = readFileSync(jarPath);
    let total = 0;
    const owner = new Map<string, string>();
    files = unzipSync(raw, {
      filter: (e) => {
        const name = e.name.replaceAll('\\', '/');
        const slash = name.indexOf('/');
        const key = wanted.has(name) ? name : slash > 0 && wanted.has(name.slice(slash + 1)) ? name.slice(slash + 1) : null;
        if (key === null || owner.has(key)) return false;
        const bytes = Math.max(e.originalSize, e.compression === 0 ? e.size : 0);
        if (bytes > PAGE_BYTES) return false;
        if ((total += bytes) > TOTAL_BYTES) throw Error('Javadoc pages exceed the total read limit');
        owner.set(key, name);
        return true;
      },
    });
    files = Object.fromEntries(Object.entries(files).map(([n, b]) => {
      const slash = n.indexOf('/');
      return [wanted.has(n) ? n : n.slice(slash + 1), b];
    }));
  } catch (e) {
    return zipError(jarPath, `Invalid or unsupported Javadoc ZIP: ${e instanceof Error ? e.message : String(e)}`);
  }

  const maxHits = Math.min(Math.max(1, opts.maxHits ?? 20), 100);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const hits: JavadocSearchHitClass[] = [];
  let hitCount = 0, totalMatches = 0, truncated = false, scanned = 0;
  for (const [rel, bytes] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const className = wanted.get(rel)!;
    if (hitCount >= maxHits) { truncated = true; break; }
    scanned++;
    const text = plainLines(parseElements(decoder.decode(bytes)), TEXT_CHARS);
    const r = searchClassSourceText(text, { query: opts.query, contextLines: opts.contextLines ?? 3, maxHits: maxHits - hitCount });
    if ('error' in r) {
      if (r.error.code === 'FIND_QUERY_INVALID') return { ok: false, error: r.error };
      continue;
    }
    totalMatches += r.totalMatches;
    if (r.hits.length) {
      hits.push({ className, sourceAvailable: false, totalMatches: r.totalMatches, hits: r.hits });
      hitCount += r.hits.length;
    }
    if (r.truncated) { truncated = true; break; }
  }
  hits.sort((a, b) => classNames.indexOf(a.className) - classNames.indexOf(b.className));
  return { ok: true, classesScanned: scanned, totalMatches, hitCount, truncated, hits };
}
