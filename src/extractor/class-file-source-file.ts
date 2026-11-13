import { readZipEntryBytes } from './zip-entry.js';

const SOURCE_FILE_NAME = /^[^/\\]+\.(java|kt|scala|groovy)$/;

/** Byte length after the tag byte, for every constant-pool tag except Utf8 (1). */
const CONSTANT_SIZES: Record<number, number> = {
  3: 4,
  4: 4,
  5: 8,
  6: 8,
  7: 2,
  8: 2,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  15: 3,
  16: 2,
  17: 4,
  18: 4,
  19: 2,
  20: 2,
};

class Truncated extends Error {}

class Reader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  u1(): number {
    if (this.pos + 1 > this.bytes.length) {
      throw new Truncated();
    }
    return this.bytes[this.pos++]!;
  }

  u2(): number {
    return (this.u1() << 8) | this.u1();
  }

  u4(): number {
    return ((this.u2() << 16) >>> 0) + this.u2();
  }

  skip(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new Truncated();
    }
    this.pos += n;
  }

  slice(n: number): Uint8Array {
    const start = this.pos;
    this.skip(n);
    return this.bytes.subarray(start, start + n);
  }
}

function skipMembers(r: Reader): void {
  const count = r.u2();
  for (let i = 0; i < count; i++) {
    r.skip(6);
    skipAttributes(r);
  }
}

function skipAttributes(r: Reader): void {
  const count = r.u2();
  for (let i = 0; i < count; i++) {
    r.skip(2);
    r.skip(r.u4());
  }
}

function parseSourceFile(bytes: Uint8Array): string | null {
  const r = new Reader(bytes);
  if (r.u4() !== 0xcafebabe) {
    return null;
  }
  r.skip(4);
  const poolCount = r.u2();
  const utf8 = new Map<number, Uint8Array>();
  for (let i = 1; i < poolCount; i++) {
    const tag = r.u1();
    if (tag === 1) {
      utf8.set(i, r.slice(r.u2()));
      continue;
    }
    const size = CONSTANT_SIZES[tag];
    if (size === undefined) {
      return null;
    }
    r.skip(size);
    if (tag === 5 || tag === 6) {
      i++;
    }
  }
  r.skip(6);
  r.skip(r.u2() * 2);
  skipMembers(r);
  skipMembers(r);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const attributes = r.u2();
  for (let i = 0; i < attributes; i++) {
    const name = utf8.get(r.u2());
    const length = r.u4();
    if (name === undefined || length !== 2 || decoder.decode(name) !== 'SourceFile') {
      r.skip(length);
      continue;
    }
    const value = utf8.get(r.u2());
    return value === undefined ? null : decoder.decode(value);
  }
  return null;
}

/**
 * The class-level `SourceFile` attribute (`Foo.kt` for `FooKt`). Returns null when the bytes
 * are not a valid class file, or the value is not a plain `.java` / `.kt` / `.scala` / `.groovy` name.
 */
export function readSourceFileAttribute(bytes: Uint8Array): string | null {
  let value: string | null;
  try {
    value = parseSourceFile(bytes);
  } catch (e) {
    if (e instanceof Truncated) {
      return null;
    }
    throw e;
  }
  if (value === null || !SOURCE_FILE_NAME.test(value)) {
    return null;
  }
  return value;
}

/** `SourceFile` of `classRelPath` in `jarPath`. A read failure gives null; name-based lookup still runs. */
export function readJarClassSourceFile(jarPath: string, classRelPath: string): string | null {
  const r = readZipEntryBytes(jarPath, classRelPath);
  return r.ok ? readSourceFileAttribute(r.bytes) : null;
}
