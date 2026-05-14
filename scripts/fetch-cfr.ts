/**
 * Downloads CFR into resources/cfr.jar (Maven Central).
 * Run: bun run setup:cfr
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CFR_VERSION = '0.152';
const CFR_URL = `https://repo1.maven.org/maven2/org/benf/cfr/${CFR_VERSION}/cfr-${CFR_VERSION}.jar`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'resources', 'cfr.jar');

const res = await fetch(CFR_URL);
if (!res.ok) {
  console.error(`Failed to download CFR: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = new Uint8Array(await res.arrayBuffer());
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, buf);
console.log(`Wrote ${dest} (${buf.byteLength} bytes, CFR ${CFR_VERSION}).`);
