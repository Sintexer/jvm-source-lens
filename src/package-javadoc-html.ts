import { posix } from 'node:path';

export type Element = { tag: string; classes: string[]; marker: string; href?: string; children: (Element | string)[] };
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const blockTags = new Set('br div p li ul ol pre h1 h2 h3 h4 table tr dl dt dd'.split(' '));
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function plainText(node: Element, limit: number) {
  const parts: string[] = [];
  function visit(el: Element) {
    if (blockTags.has(el.tag)) parts.push(' ');
    for (const child of el.children) {
      if (typeof child === 'string') parts.push(child);
      else visit(child);
    }
    if (blockTags.has(el.tag)) parts.push(' ');
  }
  visit(node);
  return parts.join('').replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, (all, key: string) => {
    if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? all;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
  }).replace(/\s+/g, ' ').trim().slice(0, limit);
}

// A bounded tree of inert text and the four attributes the standard doclet uses.
// Sticky scans consume each token once; raw script/style bodies are never tokenized.
export function parseElements(html: string) {
  const root: Element = { tag: '', classes: [], marker: '', children: [] };
  const stack = [root];
  const tag = /<(\/?)([a-z][\w:-]*)\b(?:[^'"<>]|"[^"]*"|'[^']*')*>/iy;
  const attrs = /([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let nodes = 0;
  for (let i = 0; i < html.length;) {
    const parent = stack[stack.length - 1]!;
    const start = html.indexOf('<', i);
    if (start !== i) parent.children.push(html.slice(i, start < 0 ? html.length : start));
    if (start < 0) break;
    if (++nodes > 65536) throw Error('Javadoc HTML token limit exceeded');
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', start)) {
      const end = html.indexOf('>', start + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    tag.lastIndex = start;
    const m = tag.exec(html);
    if (!m) {
      if (/[a-z/]/i.test(html[start + 1] ?? '')) throw Error('Malformed Javadoc HTML tag');
      parent.children.push('<'); i = start + 1; continue;
    }
    i = tag.lastIndex;
    const name = m[2]!.toLowerCase();
    if (m[1]) {
      for (let n = stack.length - 1; n > 0; n--) if (stack[n]!.tag === name) { stack.length = n; break; }
      continue;
    }
    if (name === 'script' || name === 'style') {
      const close = name === 'script' ? /<\/script\s*>/ig : /<\/style\s*>/ig;
      close.lastIndex = i;
      i = close.exec(html) ? close.lastIndex : html.length;
      continue;
    }
    const el: Element = { tag: name, classes: [], marker: '', children: [] };
    attrs.lastIndex = 1 + name.length;
    let a;
    while ((a = attrs.exec(m[0]))) {
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      switch (a[1]!.toLowerCase()) {
        case 'class': el.classes = value.split(/\s+/); break;
        case 'id': case 'name': el.marker = value; break;
        case 'href': el.href = value; break;
      }
    }
    parent.children.push(el);
    if (!voidTags.has(name)) stack.push(el);
    if (stack.length > 128) throw Error('Javadoc HTML depth limit exceeded');
  }
  return root;
}

const typeLink = /^([\p{ID_Start}_$][\p{ID_Continue}$.]*)\.html$/u;
export function parsePackagePage(html: string, entryPath: string) {
  const directory = posix.dirname(entryPath);
  const summaries: Record<string, string> = Object.create(null);
  let count = 0, description: string | null = null;
  function visit(parent: Element, inDescription: boolean, inTable: boolean) {
    let pending: string | undefined;
    for (const el of parent.children) {
      if (typeof el === 'string') continue;
      const marker = /^package[.-]description$/i.test(el.marker);
      if (marker && el.tag === 'a') inDescription = true; // JDK 8's empty anchor precedes the block.
      const desc = inDescription || marker || el.classes.some(c => /^package-?description$/i.test(c));
      if (desc && !description && el.classes.includes('block')) description = plainText(el, 4096) || null;
      if (inTable && el.classes.some(c => c === 'colFirst' || c === 'col-first')) {
        pending = undefined;
        function link(node: Element): string | undefined {
          if (node.tag === 'a') {
            const href = node.href;
            if (!href || href.startsWith('/') || /[:?#\\]/.test(href)) return;
            const path = posix.join(directory, href);
            if (posix.dirname(path) === directory) return typeLink.exec(posix.basename(path))?.[1];
            return;
          }
          for (const child of node.children) if (typeof child !== 'string') {
            const name = link(child);
            if (name) return name;
          }
        }
        pending = link(el);
      } else if (inTable && pending && el.classes.some(c => c === 'colLast' || c === 'col-last')) {
        const text = plainText(el, 240);
        if (text && !Object.hasOwn(summaries, pending)) {
          if (pending.length > 256 || ++count > 256) throw Error('Javadoc type summary limit exceeded');
          summaries[pending] = text;
        }
        pending = undefined;
      }
      visit(el, desc, inTable || el.classes.includes('typeSummary') || el.classes.includes('summary-table'));
    }
  }
  visit(parseElements(html), false, false);
  return { description, summaries };
}
