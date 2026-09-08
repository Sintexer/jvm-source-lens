/**
 * Removes leading Java member modifiers so the remainder starts with the type
 * (or method name for constructors after other stripping).
 */
export function stripLeadingModifiers(s: string): string {
  let cur = s.trimStart();
  for (;;) {
    const m = cur.match(
      /^(?:(?:public|private|protected|abstract|static|final|strictfp|default|synchronized|native|volatile|transient)\s+)/,
    );
    if (!m?.[0]) {
      break;
    }
    cur = cur.slice(m[0].length);
  }
  return cur.trimStart();
}
