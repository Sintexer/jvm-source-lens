import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import type { ClassSourceError } from './class-source-types.js';

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
  const want = normalizeZipEntryName(entryRelPath);
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
    return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'error',
      error: zipReadError(jarAbsPath, want, `Invalid or unsupported ZIP: ${msg}`),
    };
  }
}

export type ZipEntryExistsResult =
  | { ok: true; exists: boolean }
  | { ok: false; error: ClassSourceError };

export function zipEntryExists(jarAbsPath: string, entryRelPath: string): ZipEntryExistsResult {
  const want = normalizeZipEntryName(entryRelPath);
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
