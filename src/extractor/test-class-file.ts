/** Test-only builder for a minimal class file with an optional `SourceFile` attribute. */
export function buildClassFile(opts: { internalName: string; sourceFile?: string; superclass?: string; interfaces?: string[] }): Uint8Array {
  const out: number[] = [];
  const u1 = (v: number) => out.push(v & 0xff);
  const u2 = (v: number) => {
    u1(v >> 8);
    u1(v);
  };
  const u4 = (v: number) => {
    u2(v >>> 16);
    u2(v);
  };
  const utf8 = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    u1(1);
    u2(bytes.length);
    for (const b of bytes) {
      u1(b);
    }
  };

  u4(0xcafebabe);
  u2(0);
  u2(52);

  const interfaces = opts.interfaces ?? [];
  u2(14 + 2 * interfaces.length);
  utf8(opts.internalName); // #1
  u1(7);
  u2(1); // #2 Class
  utf8(opts.superclass ?? 'java/lang/Object'); // #3
  u1(7);
  u2(3); // #4 Class
  u1(5);
  u4(0);
  u4(42); // #5-#6 Long
  utf8('f'); // #7
  utf8('I'); // #8
  utf8('m'); // #9
  utf8('()V'); // #10
  utf8('Code'); // #11
  utf8('SourceFile'); // #12
  utf8(opts.sourceFile ?? 'unused'); // #13
  for (const [i, name] of interfaces.entries()) {
    utf8(name);
    u1(7);
    u2(14 + 2 * i);
  }

  u2(0x0021);
  u2(2);
  u2(4);
  u2(interfaces.length);
  for (const i of interfaces.keys()) u2(15 + 2 * i);

  u2(1);
  u2(0);
  u2(7);
  u2(8);
  u2(0);

  u2(1);
  u2(1);
  u2(9);
  u2(10);
  u2(1);
  u2(11);
  u4(3);
  u1(0);
  u1(0);
  u1(0);

  const hasSourceFile = opts.sourceFile !== undefined;
  u2(hasSourceFile ? 2 : 1);
  u2(11);
  u4(1);
  u1(0);
  if (hasSourceFile) {
    u2(12);
    u4(2);
    u2(13);
  }
  return Uint8Array.from(out);
}
