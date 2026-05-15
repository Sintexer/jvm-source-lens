import { declaringSimpleName } from '../class-structure/javap-parse.js';
import {
  JAVA_SOURCE_SYNTHETIC_DESC_PREFIX,
  parseJavaTypeMetadata,
} from '../class-structure/parse-java-type-metadata.js';

/** Max bytes read from each `.java` or sources-JAR entry for search enrichment. */
export const MAX_JAVA_SOURCE_BYTES_FOR_SEARCH = 256 * 1024;

/**
 * Collects plain text from Javadoc blocks for full-text search (whitespace-normalized).
 */
export function extractJavadocPlainText(javaSource: string): string {
  const parts: string[] = [];
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(javaSource)) !== null) {
    let inner = m[1] ?? '';
    inner = inner
      .replace(/^\s*\*\s?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (inner.length > 0) {
      parts.push(inner);
    }
  }
  return parts.join(' ');
}

function fieldNameForSearch(jvmDescriptor: string): string | null {
  const fp = `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}field:`;
  const ep = `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}enum:`;
  if (jvmDescriptor.startsWith(fp)) {
    return jvmDescriptor.slice(fp.length);
  }
  if (jvmDescriptor.startsWith(ep)) {
    return jvmDescriptor.slice(ep.length);
  }
  return null;
}

/**
 * Builds a lowercased, newline-joined blob from parsed members and Javadoc for `searchText` enrichment.
 */
export function buildJavaSourceSearchBlob(javaSourceRaw: string, classFqn: string): string {
  const javaSource = javaSourceRaw.slice(0, MAX_JAVA_SOURCE_BYTES_FOR_SEARCH);
  const chunks: string[] = [];

  const parsed = parseJavaTypeMetadata(javaSource, classFqn);
  if (parsed) {
    const simple = declaringSimpleName(classFqn);
    for (const meth of parsed.methods) {
      const id = meth.jvmMethodName === '<init>' ? simple : meth.jvmMethodName;
      if (id.length > 0) {
        chunks.push(id);
      }
    }
    for (const f of parsed.fields) {
      const n = fieldNameForSearch(f.jvmDescriptor);
      if (n !== null && n.length > 0) {
        chunks.push(n);
      }
    }
  }

  const jdoc = extractJavadocPlainText(javaSource);
  if (jdoc.length > 0) {
    chunks.push(jdoc);
  }

  return chunks.join('\n').toLowerCase().trim();
}
