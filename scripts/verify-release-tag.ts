/**
 * Ensures GITHUB_REF_NAME (e.g. v0.1.0) matches package.json version (e.g. 0.1.0).
 * Used by the release workflow before npm publish.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
const version = pkg.version?.trim();

const refName = process.env.GITHUB_REF_NAME?.trim() ?? '';
const tagVersion = refName.startsWith('v') ? refName.slice(1) : refName;

if (!version) {
  console.error('verify-release-tag: package.json has no version');
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+(-[\w.-]+)?$/.test(refName)) {
  console.error(`verify-release-tag: tag must look like v1.2.3 (got ${refName || '(empty)'})`);
  process.exit(1);
}

if (tagVersion !== version) {
  console.error(
    `verify-release-tag: tag ${refName} does not match package.json version ${version}`,
  );
  process.exit(1);
}

console.log(`verify-release-tag: ok (${refName} ↔ ${version})`);
