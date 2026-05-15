import type { ClassStructureDeclaredAnnotation } from './types.js';

function normalizeAnnotationSummary(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses the body immediately following a `RuntimeVisibleAnnotations:` header line. */
export function parseRuntimeVisibleAnnotationsBody(body: string): ClassStructureDeclaredAnnotation[] {
  const rawLines = body.split(/\r?\n/);
  const out: ClassStructureDeclaredAnnotation[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i]!;
    const entry = line.match(/^\s*(\d+):\s*(.*)$/);
    if (!entry) {
      i++;
      continue;
    }
    const chunk: string[] = [];
    const firstRest = entry[2]?.trim() ?? '';
    if (firstRest) {
      chunk.push(firstRest);
    }
    i++;
    while (i < rawLines.length) {
      const next = rawLines[i]!;
      if (/^\s*\d+:\s/.test(next)) {
        break;
      }
      if (next.trim().length > 0) {
        chunk.push(next.trim());
      }
      i++;
    }
    const summary = normalizeAnnotationSummary(chunk);
    if (summary.length > 0) {
      out.push({ summary });
    }
  }
  return out;
}

function outerClassTrailer(javapText: string): string {
  const m = javapText.match(/\n\}\s*\r?\nSourceFile:[^\n]*\s*\r?\n([\s\S]*)$/);
  return m?.[1] ?? '';
}

/** Class-level `RuntimeVisibleAnnotations` from the tail of `javap -verbose` (after `SourceFile:`). */
export function parseJavapOuterClassRuntimeVisibleAnnotations(javapText: string): ClassStructureDeclaredAnnotation[] {
  const trailer = outerClassTrailer(javapText);
  if (!trailer.includes('RuntimeVisibleAnnotations:')) {
    return [];
  }
  const idx = trailer.indexOf('RuntimeVisibleAnnotations:');
  const after = trailer.slice(idx + 'RuntimeVisibleAnnotations:'.length);
  const stop = after.search(/^[A-Za-z][A-Za-zA-Za-z]*:/m);
  const section = stop >= 0 ? after.slice(0, stop) : after;
  return parseRuntimeVisibleAnnotationsBody(section);
}

/** Extract annotations declared on one javap member block (field or method). */
export function parseJavapMemberRuntimeVisibleAnnotations(memberBlock: string): ClassStructureDeclaredAnnotation[] {
  const marker = '\n    RuntimeVisibleAnnotations:\n';
  const idx = memberBlock.indexOf(marker);
  if (idx < 0) {
    return [];
  }
  const tail = memberBlock.slice(idx + marker.length);
  const lines = tail.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^    [A-Z][A-Za-zA-Za-z]*:/.test(line)) {
      break;
    }
    kept.push(line);
  }
  return parseRuntimeVisibleAnnotationsBody(kept.join('\n'));
}

function splitMemberBlocks(body: string): string[] {
  const parts = body.split(/\n(?=\s{2}\S)/);
  return parts.map((p) => p.trimEnd()).filter(Boolean);
}

function fieldLikeFirstLine(firstLine: string): boolean {
  const t = firstLine.trim();
  return t.endsWith(';') && !t.includes('(');
}

function methodLikeFirstLine(firstLine: string): boolean {
  const t = firstLine.trim();
  return t.endsWith(';') && t.includes('(') && t.includes(')');
}

function fieldNameFromDeclarationLine(decl: string): string | null {
  const sem = decl.replace(/;$/, '').trim();
  const parts = sem.split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 1] ?? null) : null;
}

function normalizeDeclarationHead(decl: string): string {
  return decl.replace(/\s+/g, ' ').trim();
}

export type JavapDeclaredAnnotationsIndex = {
  classAnnotations: ClassStructureDeclaredAnnotation[];
  fields: Record<string, ClassStructureDeclaredAnnotation[]>;
  methodsByJvmDescriptor: Record<string, ClassStructureDeclaredAnnotation[]>;
  methodsByNormalizedDeclaration: Record<string, ClassStructureDeclaredAnnotation[]>;
};

/** Indexes declared annotations on the primary type using javap verbose output. */
export function buildJavapDeclaredAnnotationsIndex(javapText: string): JavapDeclaredAnnotationsIndex {
  const classAnnotations = parseJavapOuterClassRuntimeVisibleAnnotations(javapText);
  const fields: Record<string, ClassStructureDeclaredAnnotation[]> = {};
  const methodsByJvmDescriptor: Record<string, ClassStructureDeclaredAnnotation[]> = {};
  const methodsByNormalizedDeclaration: Record<string, ClassStructureDeclaredAnnotation[]> = {};

  const poolIdx = javapText.indexOf('Constant pool:');
  const innerStartMarker = javapText.indexOf('\n{\n', poolIdx);
  const sourceIdx = javapText.indexOf('\nSourceFile:', innerStartMarker >= 0 ? innerStartMarker : 0);
  if (innerStartMarker < 0 || sourceIdx < 0) {
    return { classAnnotations, fields, methodsByJvmDescriptor, methodsByNormalizedDeclaration };
  }
  const innerStart = innerStartMarker + '\n{\n'.length;
  const slice = javapText.slice(innerStart, sourceIdx);
  const lines = slice.split(/\r?\n/);
  let cut = slice.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === '}') {
      cut = lines.slice(0, i).join('\n').length;
      break;
    }
  }
  const body = slice.slice(0, cut);
  for (const block of splitMemberBlocks(body)) {
    const first = block.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
    const ann = parseJavapMemberRuntimeVisibleAnnotations(block);
    if (ann.length === 0) {
      continue;
    }
    const descriptorLine = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith('descriptor:'));
    const descriptor = descriptorLine?.slice('descriptor:'.length).trim() ?? null;

    if (methodLikeFirstLine(first) && descriptor) {
      methodsByJvmDescriptor[descriptor] = ann;
      methodsByNormalizedDeclaration[normalizeDeclarationHead(first.trim())] = ann;
    } else if (fieldLikeFirstLine(first)) {
      const name = fieldNameFromDeclarationLine(first.trim());
      if (name) {
        fields[name] = ann;
      }
    }
  }

  return { classAnnotations, fields, methodsByJvmDescriptor, methodsByNormalizedDeclaration };
}

export function lookupMethodDeclaredAnnotations(
  index: JavapDeclaredAnnotationsIndex,
  jvmDescriptor: string,
  declarationLine: string,
): ClassStructureDeclaredAnnotation[] | undefined {
  const byDesc = index.methodsByJvmDescriptor[jvmDescriptor];
  if (byDesc && byDesc.length > 0) {
    return byDesc;
  }
  const byDecl = index.methodsByNormalizedDeclaration[normalizeDeclarationHead(declarationLine)];
  return byDecl && byDecl.length > 0 ? byDecl : undefined;
}
