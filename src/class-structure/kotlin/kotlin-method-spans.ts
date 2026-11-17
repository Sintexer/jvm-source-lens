import type { MethodSourceSpan } from '../parse-java-type-metadata.js';
import { getterName, setterName } from './kotlin-jvm-names.js';
import { parseKotlinTypeMetadata } from './parse-kotlin-type-metadata.js';

/**
 * Source spans for `methodNames` excerpts of a Kotlin type. A member is listed under its JVM
 * name and its Kotlin name, so `getName` and `name` both find `val name`. Companion members
 * are included, because an agent asks the outer class for `parse` in `Outer.Companion`.
 * Returns null when the type is not in the source.
 */
export function collectKotlinMethodSpans(source: string, className: string): MethodSourceSpan[] | null {
  const meta = parseKotlinTypeMetadata(source, className);
  if (!meta) {
    return null;
  }
  const spans: MethodSourceSpan[] = [];
  for (const m of [...meta.members, ...(meta.companion?.members ?? [])]) {
    const names = new Set<string>();
    if (m.kind === 'constructor') {
      names.add('<init>');
    } else if (m.kind === 'fun') {
      names.add(m.jvmName ?? m.name);
      names.add(m.name);
    } else {
      names.add(getterName(m));
      if (m.mutable) {
        names.add(setterName(m));
      }
      names.add(m.name);
    }
    for (const jvmMethodName of names) {
      spans.push({ jvmMethodName, start: m.start, end: m.end });
    }
  }
  return spans;
}
