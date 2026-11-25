import { parseElements, plainText, type Element } from './package-javadoc-html.js';
import { readJavadocPage } from './package-javadoc.js';

export interface ClassJavadoc {
  description: string | null;
  methodDoc(name: string, descriptor: string): string | null;
  fieldDoc(name: string): string | null;
}

type Page = { entryPath: string; description: string | null; members: Record<string, string | null> };
const identifier = /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u;
const primitives: Record<string, string> = { B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int', J: 'long', S: 'short', Z: 'boolean' };
const primitiveNames = new Set(Object.values(primitives));
const detailGroup = /^(field|method|constructor|enum[.-]constant|annotation[.-](?:interface|type)[.-]element)[.-]details?$/;

function methodKey(name: string, descriptor: string): string | null {
  if ((!identifier.test(name) && name !== '<init>') || descriptor.length > 65535 || descriptor[0] !== '(') return null;
  let i = 1;
  function type(): string | null {
    const start = i;
    while (descriptor[i] === '[') i++;
    const rank = i - start;
    if (rank > 255) return null;
    const code = descriptor[i++];
    if (!code) return null;
    let base = primitives[code];
    if (code === 'L') {
      const end = descriptor.indexOf(';', i);
      if (end === -1) return null;
      const parts = descriptor.slice(i, end).split('/');
      if (!parts.every(p => identifier.test(p))) return null;
      base = parts.join('.').replaceAll('$', '.');
      if (primitiveNames.has(base)) return null;
      i = end + 1;
    }
    return base ? base + '[]'.repeat(rank) : null;
  }
  const params: string[] = [];
  while (descriptor[i] !== ')') {
    const param = type();
    if (!param) return null;
    params.push(param);
  }
  i++;
  if (descriptor[i] === 'V') i++;
  else if (name === '<init>' || !type()) return null;
  return i === descriptor.length ? `${name}(${params.join(',')})` : null;
}

function memberKey(marker: string, group: string, classFile: string): string | null {
  let id: string;
  try { id = decodeURIComponent(marker).replaceAll('&lt;', '<').replaceAll('&gt;', '>'); }
  catch { return null; }
  // The HTML4 doclet escapes leading '_' and '$' with Z:Z, and '$' as :D.
  id = id.replace(/^Z:Z/, '').replaceAll(':D', '$');
  if (group === 'field' || group === 'enum.constant') return identifier.test(id) ? id : null;
  let name: string, params: string[];
  const paren = id.indexOf('(');
  if (paren >= 0 && id.endsWith(')')) {
    name = id.slice(0, paren);
    const body = id.slice(paren + 1, -1);
    params = body ? body.split(',') : [];
  } else {
    const dash = id.indexOf('-');
    if (dash < 0 || !id.endsWith('-') || dash === id.length - 1) return null;
    name = id.slice(0, dash);
    const body = id.slice(dash + 1, -1);
    params = body ? body.replaceAll(':A', '[]').split('-') : [];
  }
  if (group === 'constructor') {
    if (name !== '<init>' && name !== classFile && name !== classFile.split('.').at(-1)) return null;
    name = '<init>';
  } else if (!identifier.test(name)) return null;
  const types: string[] = [];
  for (const [i, param] of params.entries()) {
    let t = param.trim();
    if (i === params.length - 1 && t.endsWith('...')) t = t.slice(0, -3) + '[]';
    const array = t.indexOf('[');
    if (array !== -1 && !/^(?:\[\])+$/.test(t.slice(array))) return null;
    const base = array === -1 ? t : t.slice(0, array);
    // Unqualified object names may be type variables. Never infer their erasure.
    if (!primitiveNames.has(base) && !(base.includes('.') && base.split('.').every(s => identifier.test(s)))) return null;
    types.push(t.replaceAll('$', '.'));
  }
  return `${name}(${types.join(',')})`;
}

const elements = (node: Element) => node.children.filter((c): c is Element => typeof c !== 'string');
const isBlock = (e: Element) => e.classes.includes('block');
function parsePage(html: string, entryPath: string): Page | null {
  const members: Page['members'] = Object.create(null);
  const classFile = entryPath.slice(entryPath.lastIndexOf('/') + 1, -5);
  let description: string | null = null, recognized = false;
  function record(marker: string, group: string, body: Element) {
    const key = memberKey(marker, group, classFile);
    if (key === null) return;
    const children = elements(body);
    const wrapper = children.find(e => e.classes.includes('horizontal-scroll'));
    const block = children.find(isBlock) ?? (wrapper && elements(wrapper).find(isBlock));
    const copied = block && elements(block).some(e => e.classes.includes('descfrm-type-label') || e.classes.includes('descfrmTypeLabel'));
    members[key] = !Object.hasOwn(members, key) && block && !copied ? plainText(block, 4096) || null : null;
  }
  function visit(node: Element, group: string, inDescription: boolean) {
    const children = elements(node);
    for (let i = 0; i < children.length; i++) {
      const el = children[i]!;
      if (el.tag === 'dl' || el.classes.includes('inherited-list')) continue;
      if (isBlock(el)) {
        if (inDescription && description === null) description = plainText(el, 4096) || null;
        continue; // Markup inside prose is never a doclet detail.
      }
      const desc = el.classes.includes('description') || el.classes.includes('class-description') || el.marker === 'class-description';
      if (desc) recognized = true;
      const kind = [el.marker, ...el.classes].map(c => detailGroup.exec(c)?.[1]).find(Boolean)?.replaceAll('-', '.');
      if (kind) recognized = true;
      if (kind && el.tag === 'a') group = kind; // Legacy section anchor precedes its members.
      else if (el.tag === 'section' && el.classes.includes('detail') && group) {
        record(el.marker, group, el);
        continue;
      } else if (group && el.tag === 'a' && el.marker) {
        // JDK 8/11: only the immediately following member list owns this anchor.
        const next = children[i + 1];
        if (next?.tag === 'ul') {
          const items = elements(next);
          if (items.length === 1 && items[0]!.tag === 'li') record(el.marker, group, items[0]!);
        }
      }
      visit(el, kind ?? group, inDescription || desc);
    }
  }
  visit(parseElements(html), '', false);
  return recognized ? { entryPath, description, members } : null;
}

export async function readClassJavadoc(jarPath: string, className: string): Promise<ClassJavadoc | null> {
  if (className.length > 512 || !className.split('.').every(p => identifier.test(p))) return null;
  const segments = className.split('.');
  const file = segments.pop()!.replaceAll('$', '.') + '.html';
  try {
    const page = await readJavadocPage(jarPath, [...segments, file].join('/'), 'class', 1, (value, entryPath) => {
      const p = value as Page;
      const prose = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 4096);
      return p?.entryPath === entryPath && prose(p.description) && p.members && typeof p.members === 'object' &&
        !Array.isArray(p.members) && Object.values(p.members).every(prose) ? p : null;
    }, parsePage);
    if (!page) return null;
    const lookup = (key: string | null) => key !== null && Object.hasOwn(page.members, key) ? page.members[key] ?? null : null;
    return { description: page.description, methodDoc: (name, d) => lookup(methodKey(name, d)),
      fieldDoc: name => identifier.test(name) ? lookup(name) : null };
  } catch { return null; } // Optional documentation: a broken archive cannot invalidate bytecode metadata.
}
