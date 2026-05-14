import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_CFR_BYTES = 100_000;
const MIN_INIT_GRADLE_BYTES = 20;

function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

function main(): void {
  const root = packageRoot();
  const resourcesDir = path.join(root, 'resources');
  const cfr = path.join(resourcesDir, 'cfr.jar');
  const analyzer = path.join(resourcesDir, 'analyzer-init.gradle');

  let failed = false;

  if (!fs.existsSync(cfr)) {
    console.error(`prepack: missing ${cfr}`);
    failed = true;
  } else {
    const size = fs.statSync(cfr).size;
    if (size < MIN_CFR_BYTES) {
      console.error(
        `prepack: ${cfr} is too small (${size} bytes; need >= ${MIN_CFR_BYTES}). ` +
          'Add the CFR JAR before publishing (see README / upstream CFR releases).',
      );
      failed = true;
    }
  }

  if (!fs.existsSync(analyzer)) {
    console.error(`prepack: missing ${analyzer}`);
    failed = true;
  } else {
    const size = fs.statSync(analyzer).size;
    if (size < MIN_INIT_GRADLE_BYTES) {
      console.error(
        `prepack: ${analyzer} is too small (${size} bytes; need >= ${MIN_INIT_GRADLE_BYTES}). ` +
          'Replace the placeholder with the real Gradle init script.',
      );
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('prepack: bundled resources validation passed.');
}

main();
