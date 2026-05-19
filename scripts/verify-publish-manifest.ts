/**
 * CI hygiene: ensure package.json `files` / `bin` targets exist on disk after build + setup:cfr.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(): void {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    files?: string[];
    bin?: Record<string, string>;
  };

  let failed = false;

  for (const rel of pkg.files ?? []) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.error(`verify-publish-manifest: missing files entry: ${rel}`);
      failed = true;
    }
  }

  for (const [name, rel] of Object.entries(pkg.bin ?? {})) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.error(`verify-publish-manifest: bin.${name} target missing: ${rel}`);
      failed = true;
    }
  }

  const requiredBundled = [
    'resources/cfr.jar',
    'resources/analyzer-init.gradle',
    'dist/cli.js',
    'dist/mcp.js',
    'dist/public-api.js',
  ];
  for (const rel of requiredBundled) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.error(`verify-publish-manifest: required publish artifact missing: ${rel}`);
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('verify-publish-manifest: ok');
}

main();
