import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Bun test preload: keep failure diagnostics and caches out of the developer's real
 * `~/Library/Logs/jvmsrc` and cache dirs. Individual tests may still override these env vars.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-test-'));
process.env.JVMSRC_LOG_DIR ??= path.join(root, 'logs');
process.env.JVMSRC_CACHE_ROOT ??= path.join(root, 'cache');
