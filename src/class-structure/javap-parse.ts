import type { JavapMethodOverload, JavapParameter, JavapClassHeader, JavapClassKind, JavapFieldInfo, JavapMethodWithName } from './types.js';

export function declaringSimpleName(classFqn: string): string {
  const dollar = classFqn.lastIndexOf('$');
  if (dollar >= 0) {
    return classFqn.slice(dollar + 1);
  }
  const dot = classFqn.lastIndexOf('.');
  return dot >= 0 ? classFqn.slice(dot + 1) : classFqn;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractClassMemberSection(javapText: string): string | null {
  const poolIdx = javapText.indexOf('Constant pool:');
  if (poolIdx < 0) {
    return null;
  }
  const innerStartMarker = javapText.indexOf('\n{\n', poolIdx);
  if (innerStartMarker < 0) {
    return null;
  }
  const innerStart = innerStartMarker + '\n{\n'.length;
  const sourceIdx = javapText.indexOf('\nSourceFile:', innerStart);
  if (sourceIdx < 0) {
    return null;
  }
  const slice = javapText.slice(innerStart, sourceIdx);
  const lines = slice.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === '}') {
      return lines.slice(0, i).join('\n');
    }
  }
  return null;
}

function splitMemberBlocks(body: string): string[] {
  const parts = body.split(/\n(?=\s{2}\S)/);
  return parts.map((p) => p.trimEnd()).filter(Boolean);
}

function isLikelyMethodBlock(block: string): boolean {
  const first = block.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const t = first.trim();
  if (!t.endsWith(';')) {
    return false;
  }
  if (!t.includes('(') || !t.includes(')')) {
    return false;
  }
  if (t.startsWith('static {') || t.startsWith('{')) {
    return false;
  }
  return true;
}

function stripLeadingModifiers(s: string): string {
  let cur = s.trimStart();
  for (;;) {
    const m = cur.match(
      /^(?:(?:public|private|protected|abstract|static|final|strictfp|default|synchronized|native)\s+)/,
    );
    if (!m?.[1]) {
      break;
    }
    cur = cur.slice(m[1].length);
  }
  return cur.trimStart();
}

function stripMethodGenericsPrefix(s: string): string {
  let cur = s.trimStart();
  while (cur.startsWith('<')) {
    let depth = 0;
    let i = 0;
    for (; i < cur.length; i++) {
      const c = cur[i];
      if (c === '<') {
        depth++;
      } else if (c === '>') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) {
      return cur;
    }
    cur = cur.slice(i).trimStart();
  }
  return cur;
}

function isConstructorDeclaration(declLine: string, classFqn: string): boolean {
  const inner = stripMethodGenericsPrefix(stripLeadingModifiers(declLine.trim()));
  const open = inner.indexOf('(');
  if (open < 0) {
    return false;
  }
  const head = inner.slice(0, open).trim();
  const simple = declaringSimpleName(classFqn);
  return head === simple || head.endsWith('.' + simple);
}

function matchesRequestedMethod(declLine: string, methodName: string, classFqn: string): boolean {
  if (methodName === '<init>') {
    return isConstructorDeclaration(declLine, classFqn);
  }
  const re = new RegExp(`\\b${escapeRegex(methodName)}\\s*\\(`);
  return re.test(declLine);
}

export function skipJvmType(descriptor: string, i: number): number {
  const c = descriptor[i];
  switch (c) {
    case 'B':
    case 'C':
    case 'D':
    case 'F':
    case 'I':
    case 'J':
    case 'S':
    case 'Z':
    case 'V':
      return i + 1;
    case '[':
      return skipJvmType(descriptor, i + 1);
    case 'L': {
      const semi = descriptor.indexOf(';', i);
      return semi >= 0 ? semi + 1 : descriptor.length;
    }
    default:
      return i + 1;
  }
}

export function countJvmParameters(descriptor: string): number {
  if (!descriptor.startsWith('(')) {
    return 0;
  }
  let i = 1;
  let n = 0;
  while (i < descriptor.length && descriptor[i] !== ')') {
    n++;
    i = skipJvmType(descriptor, i);
  }
  return n;
}

export function splitJvmParameters(descriptor: string): string[] {
  const out: string[] = [];
  if (!descriptor.startsWith('(')) {
    return out;
  }
  let i = 1;
  while (i < descriptor.length && descriptor[i] !== ')') {
    const start = i;
    i = skipJvmType(descriptor, i);
    out.push(descriptor.slice(start, i));
  }
  return out;
}

function extractParenContent(line: string): string | null {
  const open = line.indexOf('(');
  if (open < 0) {
    return null;
  }
  let depthParen = 0;
  let depthAngle = 0;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    } else if (depthAngle === 0 && c === '(') {
      depthParen++;
    } else if (depthAngle === 0 && c === ')') {
      depthParen--;
      if (depthParen === 0) {
        return line.slice(open + 1, i);
      }
    }
  }
  return null;
}

function splitJavaParameters(paramsStr: string): string[] {
  const out: string[] = [];
  let depthAngle = 0;
  let cur = '';
  for (let i = 0; i < paramsStr.length; i++) {
    const c = paramsStr[i];
    if (c === '<') {
      depthAngle++;
    } else if (c === '>') {
      depthAngle--;
    }
    if (c === ',' && depthAngle === 0) {
      const t = cur.trim();
      if (t) {
        out.push(t);
      }
      cur = '';
      continue;
    }
    cur += c;
  }
  const last = cur.trim();
  if (last) {
    out.push(last);
  }
  return out;
}

function stripAnnotationsPrefix(segment: string): string {
  let s = segment.trim();
  for (;;) {
    const idx = s.search(/@\s*[\w$.]+/);
    if (idx !== 0) {
      break;
    }
    let depth = 0;
    let i = 0;
    let started = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '(') {
        depth++;
        started = true;
      } else if (c === ')') {
        depth--;
        if (started && depth === 0) {
          i++;
          break;
        }
      } else if (!started && (c === ' ' || c === '\t')) {
        break;
      }
    }
    if (!started) {
      s = s.slice(i).trimStart();
      continue;
    }
    s = s.slice(i).trimStart();
  }
  return s.replace(/^final\s+/, '').trim();
}

function parseOneParamSegment(segment: string): { typeDisplay: string; name: string | null } {
  const s = stripAnnotationsPrefix(segment);
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const name = tokens[tokens.length - 1]!;
    const typeDisplay = tokens.slice(0, -1).join(' ');
    return { typeDisplay, name };
  }
  return { typeDisplay: s, name: null };
}

function parseLocalVariableSlots(block: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = block.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if (line.includes('LocalVariableTable:')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (/^\s*Start\s+Length\s+Slot\s+Name\s+Signature/.test(line)) {
        continue;
      }
      const trimmed = line.trimStart();
      const cols = trimmed.split(/\s+/).filter((c) => c.length > 0);
      const [c0, c1, c2] = cols;
      if (
        cols.length >= 5 &&
        c0 !== undefined &&
        c1 !== undefined &&
        c2 !== undefined &&
        /^\d+$/.test(c0) &&
        /^\d+$/.test(c1) &&
        /^\d+$/.test(c2)
      ) {
        const slot = Number(c2);
        const name = cols.slice(3, -1).join(' ');
        if (name.length > 0 && !map.has(slot)) {
          map.set(slot, name);
        }
        continue;
      }
      if (
        line.trim().startsWith('StackMapTable:') ||
        line.trim().startsWith('LineNumberTable:') ||
        line.trim().startsWith('RuntimeInvisible')
      ) {
        inTable = false;
      }
    }
  }
  return map;
}

function parseThrownExceptions(block: string): string[] {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  let inEx = false;
  for (const line of lines) {
    if (line.includes('Exceptions:')) {
      inEx = true;
      continue;
    }
    if (inEx) {
      const m = line.match(/^\s*throws\s+(.+)\s*$/);
      if (m?.[1]) {
        const parts = m[1].split(',').map((s) => s.trim());
        out.push(...parts.filter(Boolean));
        break;
      }
      if (line.trim() !== '') {
        break;
      }
    }
  }
  return out;
}

function parseVisibility(flagsLine: string | null | undefined): JavapMethodOverload['visibility'] {
  if (!flagsLine) {
    return 'package';
  }
  if (flagsLine.includes('ACC_PUBLIC')) {
    return 'public';
  }
  if (flagsLine.includes('ACC_PROTECTED')) {
    return 'protected';
  }
  if (flagsLine.includes('ACC_PRIVATE')) {
    return 'private';
  }
  return 'package';
}

export function parseJavapVisibility(flagsLine: string | null | undefined): JavapMethodOverload['visibility'] {
  return parseVisibility(flagsLine);
}

function shouldSkipSyntheticMethod(flagsLine: string | null | undefined): boolean {
  if (!flagsLine) {
    return false;
  }
  return flagsLine.includes('ACC_BRIDGE') || flagsLine.includes('ACC_SYNTHETIC');
}

function findLineValue(block: string, prefix: string): string | null {
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trimStart();
    if (t.startsWith(prefix)) {
      return t.slice(prefix.length).trim();
    }
  }
  return null;
}

function parseMethodBlock(block: string, classFqn: string, methodName: string): JavapMethodOverload | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const declarationLine = lines[0]?.trimEnd() ?? '';
  if (!matchesRequestedMethod(declarationLine, methodName, classFqn)) {
    return null;
  }

  const descriptor = findLineValue(block, 'descriptor:');
  if (!descriptor) {
    return null;
  }

  const flagsLine = findLineValue(block, 'flags:');
  if (shouldSkipSyntheticMethod(flagsLine)) {
    return null;
  }

  const genericSigRaw = findLineValue(block, 'Signature:');
  const visibility = parseVisibility(flagsLine);
  const thrownExceptions = parseThrownExceptions(block);

  const isStatic = Boolean(flagsLine?.includes('ACC_STATIC'));
  const paramCount = countJvmParameters(descriptor);
  const slotNames = parseLocalVariableSlots(block);

  const jvmParamDescriptors = splitJvmParameters(descriptor);
  const parenInner = extractParenContent(declarationLine);
  const declSegments =
    parenInner !== null && parenInner.trim().length > 0 ? splitJavaParameters(parenInner) : [];

  const parameters: JavapParameter[] = [];
  for (let pi = 0; pi < paramCount; pi++) {
    const slot = isStatic ? pi : pi + 1;
    const tableName = slotNames.get(slot) ?? null;
    let typeDisplay = jvmParamDescriptors[pi] ?? '';
    let name: string | null = tableName;

    const seg = declSegments[pi];
    if (seg) {
      const parsed = parseOneParamSegment(seg);
      typeDisplay = parsed.typeDisplay;
      if (parsed.name && (!name || name === '<no name>')) {
        name = parsed.name;
      }
    }

    if (name === '<no name>') {
      name = null;
    }

    parameters.push({
      name,
      typeDisplay,
    });
  }

  const strippedReturn = stripMethodGenericsPrefix(
    stripLeadingModifiers(declarationLine.replace(/;$/, '').trim()),
  );
  const openParen = strippedReturn.indexOf('(');
  let returnTypeDisplay: string | null = null;
  if (methodName !== '<init>' && openParen > 0) {
    const head = strippedReturn.slice(0, openParen).trim();
    const parts = head.split(/\s+/);
    if (parts.length >= 2) {
      returnTypeDisplay = parts.slice(0, -1).join(' ');
    }
  }

  return {
    declarationLine,
    visibility,
    jvmDescriptor: descriptor,
    genericSignature: genericSigRaw && genericSigRaw.length > 0 ? genericSigRaw : null,
    returnTypeDisplay,
    parameters,
    thrownExceptions,
    flagsLine: flagsLine ?? null,
  };
}

/**
 * Parses `javap -private -verbose` stdout for one class and collects overloads of `methodName`.
 */
export function parseJavapVerboseMethods(
  javapText: string,
  methodName: string,
  classFqn: string,
): JavapMethodOverload[] {
  const body = extractClassMemberSection(javapText);
  if (!body) {
    return [];
  }

  const blocks = splitMemberBlocks(body);
  const overloads: JavapMethodOverload[] = [];

  for (const block of blocks) {
    if (!isLikelyMethodBlock(block)) {
      continue;
    }
    const parsed = parseMethodBlock(block, classFqn, methodName);
    if (parsed) {
      overloads.push(parsed);
    }
  }

  return overloads;
}

function stripGenericsFromFqnLike(s: string): string {
  let t = s.trim();
  for (;;) {
    const open = t.indexOf('<');
    if (open < 0) {
      return t;
    }
    let depth = 0;
    let i = open;
    for (; i < t.length; i++) {
      const c = t[i];
      if (c === '<') {
        depth++;
      } else if (c === '>') {
        depth--;
        if (depth === 0) {
          t = (t.slice(0, open) + t.slice(i + 1)).trim();
          break;
        }
      }
    }
    if (depth !== 0) {
      return t.slice(0, open).trim();
    }
  }
}

function topLevelKeywordIndex(haystack: string, keyword: string): number {
  let depth = 0;
  for (let i = 0; i < haystack.length; i++) {
    const c = haystack[i];
    if (c === '<') {
      depth++;
    } else if (c === '>') {
      depth--;
    } else if (depth === 0 && haystack.startsWith(keyword, i)) {
      return i;
    }
  }
  return -1;
}

function splitCommaTopLevel(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<') {
      depth++;
    } else if (c === '>') {
      depth--;
    }
    if (c === ',' && depth === 0) {
      const t = cur.trim();
      if (t) {
        out.push(stripGenericsFromFqnLike(t));
      }
      cur = '';
      continue;
    }
    cur += c;
  }
  const last = cur.trim();
  if (last) {
    out.push(stripGenericsFromFqnLike(last));
  }
  return out;
}

function extractTypeParameterNames(declLine: string): string[] {
  const open = declLine.indexOf('<');
  if (open < 0) {
    return [];
  }
  let depth = 0;
  for (let i = open; i < declLine.length; i++) {
    const c = declLine[i];
    if (c === '<') {
      depth++;
    } else if (c === '>') {
      depth--;
      if (depth === 0) {
        const inner = declLine.slice(open + 1, i);
        const parts = splitCommaTopLevelInner(inner);
        return parts.map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
      }
    }
  }
  return [];
}

function splitCommaTopLevelInner(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<') {
      depth++;
    } else if (c === '>') {
      depth--;
    } else if (c === ',' && depth === 0) {
      const t = cur.trim();
      if (t) {
        out.push(t);
      }
      cur = '';
      continue;
    }
    cur += c;
  }
  const last = cur.trim();
  if (last) {
    out.push(last);
  }
  return out;
}

function kindFromFlags(flagsLine: string | null): JavapClassKind {
  if (!flagsLine) {
    return 'class';
  }
  if (flagsLine.includes('ACC_ENUM')) {
    return 'enum';
  }
  if (flagsLine.includes('ACC_ANNOTATION') && flagsLine.includes('ACC_INTERFACE')) {
    return 'annotation';
  }
  if (flagsLine.includes('ACC_INTERFACE')) {
    return 'interface';
  }
  if (flagsLine.includes('ACC_RECORD')) {
    return 'record';
  }
  return 'class';
}

function findMainDeclarationLine(head: string): string | null {
  const lines = head.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (
      /\b(class|enum|record)\s+/.test(t) ||
      /\binterface\s+/.test(t) ||
      /\@interface\b/.test(t)
    ) {
      return line.trimEnd();
    }
  }
  return null;
}

function findFlagsLineRaw(head: string): string | null {
  const m = head.match(/^\s*flags:\s*\([^)]+\)\s*(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

function parseSuperAndInterfaces(declLine: string, kind: JavapClassKind): { superClass: string | null; directInterfaces: string[] } {
  if (kind === 'interface' || kind === 'annotation') {
    const ix = topLevelKeywordIndex(declLine, ' extends ');
    if (ix < 0) {
      return { superClass: null, directInterfaces: [] };
    }
    const tail = declLine.slice(ix + ' extends '.length).trim();
    return { superClass: null, directInterfaces: splitCommaTopLevel(tail) };
  }

  const implIx = topLevelKeywordIndex(declLine, ' implements ');
  const extIx = topLevelKeywordIndex(declLine, ' extends ');

  let superClass: string | null = null;
  if (extIx >= 0) {
    const end = implIx >= 0 ? implIx : declLine.length;
    const extVal = declLine.slice(extIx + ' extends '.length, end).trim();
    superClass = stripGenericsFromFqnLike(extVal);
  }

  let directInterfaces: string[] = [];
  if (implIx >= 0) {
    const implVal = declLine.slice(implIx + ' implements '.length).trim();
    directInterfaces = splitCommaTopLevel(implVal);
  }

  return { superClass, directInterfaces };
}

export function parseJavapClassHeader(javapText: string): JavapClassHeader | null {
  const poolIdx = javapText.indexOf('Constant pool:');
  const head = poolIdx >= 0 ? javapText.slice(0, poolIdx) : javapText;
  const flagsLine = findFlagsLineRaw(head);
  const decl = findMainDeclarationLine(head);
  if (!decl) {
    return null;
  }
  const kind = kindFromFlags(flagsLine);
  const { superClass, directInterfaces } = parseSuperAndInterfaces(decl, kind);
  const typeParameterNames = extractTypeParameterNames(decl);
  return {
    kind,
    declarationLine: decl,
    flagsLine,
    superClass,
    directInterfaces,
    typeParameterNames,
  };
}

function isLikelyFieldBlock(block: string): boolean {
  const first = block.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const t = first.trim();
  if (!t.endsWith(';')) {
    return false;
  }
  if (t.includes('(')) {
    return false;
  }
  if (t.startsWith('static {') || t.startsWith('{')) {
    return false;
  }
  return true;
}

function isFieldEnumConstant(flagsLine: string | null | undefined): boolean {
  return Boolean(flagsLine?.includes('ACC_ENUM'));
}

function parseFieldBlock(block: string): JavapFieldInfo | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const declarationLine = lines[0]?.trimEnd() ?? '';
  const descriptor = findLineValue(block, 'descriptor:');
  if (!descriptor) {
    return null;
  }
  const flagsLine = findLineValue(block, 'flags:');
  return {
    declarationLine,
    visibility: parseVisibility(flagsLine),
    jvmDescriptor: descriptor,
    flagsLine: flagsLine ?? null,
    enumConstant: isFieldEnumConstant(flagsLine),
  };
}

export function parseJavapFields(javapText: string): JavapFieldInfo[] {
  const body = extractClassMemberSection(javapText);
  if (!body) {
    return [];
  }
  const blocks = splitMemberBlocks(body);
  const out: JavapFieldInfo[] = [];
  for (const block of blocks) {
    if (!isLikelyFieldBlock(block)) {
      continue;
    }
    const parsed = parseFieldBlock(block);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function extractJvmMethodName(declLine: string, classFqn: string): string | null {
  if (isConstructorDeclaration(declLine, classFqn)) {
    return '<init>';
  }
  const inner = stripMethodGenericsPrefix(stripLeadingModifiers(declLine.trim().replace(/;$/, '')));
  const open = inner.indexOf('(');
  if (open < 0) {
    return null;
  }
  const head = inner.slice(0, open).trim();
  const parts = head.split(/\s+/).filter(Boolean);
  const name = parts[parts.length - 1];
  return name ?? null;
}

function parseMethodBlockAny(block: string, classFqn: string): JavapMethodWithName | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const declarationLine = lines[0]?.trimEnd() ?? '';
  const descriptor = findLineValue(block, 'descriptor:');
  if (!descriptor) {
    return null;
  }
  const flagsLine = findLineValue(block, 'flags:');
  if (shouldSkipSyntheticMethod(flagsLine)) {
    return null;
  }

  const jvmMethodName = extractJvmMethodName(declarationLine, classFqn);
  if (!jvmMethodName || jvmMethodName === '<clinit>') {
    return null;
  }

  const genericSigRaw = findLineValue(block, 'Signature:');
  const visibility = parseVisibility(flagsLine);
  const thrownExceptions = parseThrownExceptions(block);
  const isStatic = Boolean(flagsLine?.includes('ACC_STATIC'));
  const paramCount = countJvmParameters(descriptor);
  const slotNames = parseLocalVariableSlots(block);
  const jvmParamDescriptors = splitJvmParameters(descriptor);
  const parenInner = extractParenContent(declarationLine);
  const declSegments =
    parenInner !== null && parenInner.trim().length > 0 ? splitJavaParameters(parenInner) : [];

  const parameters: JavapParameter[] = [];
  for (let pi = 0; pi < paramCount; pi++) {
    const slot = isStatic ? pi : pi + 1;
    const tableName = slotNames.get(slot) ?? null;
    let typeDisplay = jvmParamDescriptors[pi] ?? '';
    let name: string | null = tableName;
    const seg = declSegments[pi];
    if (seg) {
      const parsedP = parseOneParamSegment(seg);
      typeDisplay = parsedP.typeDisplay;
      if (parsedP.name && (!name || name === '<no name>')) {
        name = parsedP.name;
      }
    }
    if (name === '<no name>') {
      name = null;
    }
    parameters.push({ name, typeDisplay });
  }

  const strippedReturn = stripMethodGenericsPrefix(
    stripLeadingModifiers(declarationLine.replace(/;$/, '').trim()),
  );
  const openParen = strippedReturn.indexOf('(');
  let returnTypeDisplay: string | null = null;
  if (jvmMethodName !== '<init>' && openParen > 0) {
    const head = strippedReturn.slice(0, openParen).trim();
    const parts2 = head.split(/\s+/);
    if (parts2.length >= 2) {
      returnTypeDisplay = parts2.slice(0, -1).join(' ');
    }
  }

  return {
    declarationLine,
    visibility,
    jvmDescriptor: descriptor,
    genericSignature: genericSigRaw && genericSigRaw.length > 0 ? genericSigRaw : null,
    returnTypeDisplay,
    parameters,
    thrownExceptions,
    flagsLine: flagsLine ?? null,
    jvmMethodName,
  };
}

export type JavapMethodFilter = {
  /** When set, only these visibilities (e.g. public+protected for inheritance). */
  visibilityIn?: Array<JavapMethodOverload['visibility']>;
  includeStatic: boolean;
};

export function parseJavapVerboseAllMethods(
  javapText: string,
  classFqn: string,
  filter?: JavapMethodFilter,
): JavapMethodWithName[] {
  const body = extractClassMemberSection(javapText);
  if (!body) {
    return [];
  }
  const visSet = filter?.visibilityIn;
  const blocks = splitMemberBlocks(body);
  const overloads: JavapMethodWithName[] = [];
  for (const block of blocks) {
    if (!isLikelyMethodBlock(block)) {
      continue;
    }
    const parsed = parseMethodBlockAny(block, classFqn);
    if (!parsed) {
      continue;
    }
    if (!filter?.includeStatic && parsed.flagsLine?.includes('ACC_STATIC')) {
      continue;
    }
    if (visSet && !visSet.includes(parsed.visibility)) {
      continue;
    }
    overloads.push(parsed);
  }
  return overloads;
}
