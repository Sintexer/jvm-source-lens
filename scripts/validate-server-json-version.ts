import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ServerJson = {
  version?: string;
  packages?: Array<{ version?: string }>;
};

function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

function main(): void {
  const root = packageRoot();
  const pkgPath = path.join(root, 'package.json');
  const serverPath = path.join(root, 'server.json');

  const pkgVersion = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  const server = JSON.parse(fs.readFileSync(serverPath, 'utf8')) as ServerJson;
  const npmPackageVersion = server.packages?.[0]?.version;

  let failed = false;

  if (server.version !== pkgVersion) {
    console.error(
      `server.json: version is "${server.version ?? '(missing)'}" but package.json is "${pkgVersion}"`,
    );
    failed = true;
  }

  if (npmPackageVersion !== pkgVersion) {
    console.error(
      `server.json: packages[0].version is "${npmPackageVersion ?? '(missing)'}" but package.json is "${pkgVersion}"`,
    );
    failed = true;
  }

  if (failed) {
    console.error(
      'MCP registry metadata must match package.json; Release Please bumps server.json via extra-files.',
    );
    process.exit(1);
  }

  console.log(`server.json versions match package.json (${pkgVersion})`);
}

main();
