import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import type { ClassSourceError } from './class-source-types.js';
import { packageNameFromSource } from '../class-search/source-package.js';
import { checkJarSize } from './jar-size-guard.js';

function normalizeZipEntryName(name: string): string {
  return name.replaceAll('\\', '/').replace(/^\//, '');
}

export type ReadZipUtf8Result =
  | { ok: true; text: string }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'error'; error: ClassSourceError };

function zipReadError(jarPath: string, entryRelPath: string, message: string): ClassSourceError {
  return {
    code: 'ZIP_READ_ERROR',
    message,
    jarPath,
    entryRelPath,
  };
}

/**
 * Reads a single ZIP entry as UTF-8 text. Uses `fflate` with a filter so the
 * archive is not fully expanded into memory.
 */
export function readZipEntryUtf8(jarAbsPath: string, entryRelPath: string): ReadZipUtf8Result {
  const r = readZipEntryBytes(jarAbsPath, entryRelPath);
  if (!r.ok) {
    return r;
  }
  return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(r.bytes) };
}

export type ReadZipBytesResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'error'; error: ClassSourceError };

export function readZipEntryBytes(jarAbsPath: string, entryRelPath: string): ReadZipBytesResult {
  const want = normalizeZipEntryName(entryRelPath);
  const size = checkJarSize(jarAbsPath);
  if (!size.ok) {
    return { ok: false, reason: 'error', error: zipReadError(jarAbsPath, want, size.message) };
  }
  let raw: Uint8Array;
  try {
    raw = readFileSync(jarAbsPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'error',
      error: zipReadError(jarAbsPath, want, `Failed to read archive: ${msg}`),
    };
  }

  try {
    const files = unzipSync(raw, {
      filter: (info) => normalizeZipEntryName(info.name) === want,
    });
    const key = Object.keys(files).find((k) => normalizeZipEntryName(k) === want);
    if (key === undefined) {
      return { ok: false, reason: 'missing' };
    }
    const bytes = files[key];
    if (bytes === undefined) {
      return { ok: false, reason: 'missing' };
    }
    return { ok: true, bytes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'error',
      error: zipReadError(jarAbsPath, want, `Invalid or unsupported ZIP: ${msg}`),
    };
  }
}

export type FindSourceEntriesResult =
  | { ok: true; entryRelPaths: string[] }
  | { ok: false; error: ClassSourceError };

const JVM_SOURCE_SET = /^(jvm|android)(Main)?$/i;
const NON_JVM_SOURCE_SET = /^(common|native|js|wasm\w*|ios\w*|macos\w*|linux\w*|mingw\w*)Main$/i;

/** 0 = JVM source set, 1 = unknown folder, 2 = common or non-JVM source set. */
function sourceSetRank(entryPath: string): number {
  const folders = entryPath.split('/').slice(0, -1);
  if (folders.some((f) => JVM_SOURCE_SET.test(f))) {
    return 0;
  }
  return folders.some((f) => NON_JVM_SOURCE_SET.test(f)) ? 2 : 1;
}

/**
 * Entries named `fileName` (any folder) whose `package` line is `packageName`. Kotlin
 * Multiplatform sources JARs store `commonMain/Job.kt`, not `kotlinx/coroutines/Job.kt`, so the
 * package line decides which same-named file belongs to the class. `packageName` is empty for
 * the default package. Results are sorted for a stable pick: JVM source sets (`jvmMain`,
 * `androidMain`) first, then unknown folders, then `commonMain` and other platforms.
 */
export function findSourceEntriesByFileName(
  jarAbsPath: string,
  fileName: string,
  packageName: string,
): FindSourceEntriesResult {
  const size = checkJarSize(jarAbsPath);
  if (!size.ok) {
    return { ok: false, error: zipReadError(jarAbsPath, fileName, size.message) };
  }
  let raw: Uint8Array;
  try {
    raw = readFileSync(jarAbsPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: zipReadError(jarAbsPath, fileName, `Failed to read archive: ${msg}`) };
  }
  const baseOf = (name: string): string => normalizeZipEntryName(name).split('/').pop() ?? '';
  try {
    const files = unzipSync(raw, { filter: (info) => baseOf(info.name) === fileName });
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const entryRelPaths = Object.entries(files)
      .filter(([, bytes]) => (packageNameFromSource(decoder.decode(bytes)) ?? '') === packageName)
      .map(([name]) => normalizeZipEntryName(name))
      .sort((a, b) => sourceSetRank(a) - sourceSetRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    return { ok: true, entryRelPaths };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: zipReadError(jarAbsPath, fileName, `Invalid or unsupported ZIP: ${msg}`) };
  }
}

export type ZipEntryExistsResult =
  | { ok: true; exists: boolean }
  | { ok: false; error: ClassSourceError };

export function zipEntryExists(jarAbsPath: string, entryRelPath: string): ZipEntryExistsResult {
  const want = normalizeZipEntryName(entryRelPath);
  const size = checkJarSize(jarAbsPath);
  if (!size.ok) {
    return { ok: false, error: zipReadError(jarAbsPath, want, size.message) };
  }
  let raw: Uint8Array;
  try {
    raw = readFileSync(jarAbsPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: zipReadError(jarAbsPath, want, `Failed to read archive: ${msg}`) };
  }

  try {
    const files = unzipSync(raw, {
      filter: (info) => normalizeZipEntryName(info.name) === want,
    });
    const key = Object.keys(files).find((k) => normalizeZipEntryName(k) === want);
    return { ok: true, exists: key !== undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: zipReadError(jarAbsPath, want, `Invalid or unsupported ZIP: ${msg}`) };
  }
}
