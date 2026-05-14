import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_RESOURCE_NAMES = [
  'cfr.jar',
  'analyzer-init.gradle',
  'poc-resolve-init.gradle',
] as const;

export type BundledResourceName = (typeof BUNDLED_RESOURCE_NAMES)[number];

const ALLOWED = new Set<string>(BUNDLED_RESOURCE_NAMES);

function findPackageRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const name = JSON.parse(raw) as { name?: string };
        if (name.name === 'jvm-dependency-resolver') {
          return dir;
        }
      } catch {
        /* ignore malformed */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find package root (package.json).');
    }
    dir = parent;
  }
}

function resourcesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findPackageRoot(here);
  return path.join(root, 'resources');
}

export function getBundledResource(filename: BundledResourceName): string {
  const base = path.basename(filename);
  if (base !== filename || !ALLOWED.has(base)) {
    throw new Error(`Invalid bundled resource name: ${filename}`);
  }
  const dir = resourcesDir();
  const resourcePath = path.resolve(dir, base);
  const resolvedDir = path.resolve(dir);
  if (resourcePath !== resolvedDir && !resourcePath.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Refusing path outside resources directory: ${resourcePath}`);
  }
  if (!fs.existsSync(resourcePath)) {
    throw new Error(`Bundled resource '${filename}' not found at ${resourcePath}.`);
  }
  return resourcePath;
}
