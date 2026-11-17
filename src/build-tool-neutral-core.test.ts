import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

const SRC = path.dirname(new URL(import.meta.url).pathname);

/**
 * Strips line and block comments while keeping string and template literals intact,
 * so `https://...` inside strings is not misread as a `//` comment.
 */
export function stripCommentsPreservingStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          out += '\n';
        }
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += src[i++];
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i++] ?? '';
        }
        if (i < src.length) {
          out += src[i++];
        }
      }
      if (i < src.length) {
        out += src[i++];
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

function* nonTestSourceFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* nonTestSourceFiles(p);
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
      yield p;
    }
  }
}

/**
 * Files outside `src/resolvers/gradle/**` and `src/resolvers/index.ts` that still import
 * `resolvers/gradle/*`. Shrunk to empty by checkpoint 8.
 */
const GRADLE_IMPORT_ALLOWLIST: Record<string, string> = {};

/**
 * Files outside `src/resolvers/gradle/**` allowed to mention `/gradle/i` in executable code.
 * Every entry names the checkpoint that owns removing it; stale entries fail the ratchet test.
 */
const GRADLE_REFERENCE_ALLOWLIST: Record<string, string> = {
  // Registry wires built-in resolvers by design:
  'resolvers/index.ts': 'permanent — resolver registry wires GradleResolver',

  // Bundled resource filename allowlist:
  'bundled-resources.ts': 'permanent — bundled resource filename analyzer-init.gradle',

  // Pragmatic allowlist owned by later checkpoints:
  'jdk/detect-required-version.ts': 'checkpoint 9 — build-tool-aware JDK detection',
  'jdk/doctor-java.ts': 'checkpoint 9 — build-tool-aware JDK doctor',
  'jdk/find-jdk.ts': 'checkpoint 9 — JDK discovery (~/.gradle/jdks toolchain cache)',
  'jdk/resolve-jdk-for-project.ts': 'checkpoint 9 — build-tool-aware JDK resolution',
  'cli.ts': 'checkpoint 10 — CLI option descriptions',
  'cli-config-command.ts': 'checkpoint 10 — public config JSON hasGradleWrapper hint',
  'diagnostics/build-context.ts': 'checkpoint 10 — diagnostic context gradleVersion field',
  'diagnostics/diagnostic-record.ts': 'checkpoint 10 — documented DiagnosticRecord.context.gradleVersion field',
  'diagnostics/map-failure.ts': 'checkpoint 10 — resolver-specific failure classification',
};

describe('build-tool-neutral core guard', () => {
  const allRelCode = [...nonTestSourceFiles(SRC)]
    .map((abs) => ({
      rel: path.relative(SRC, abs).split(path.sep).join('/'),
      code: stripCommentsPreservingStrings(readFileSync(abs, 'utf8')),
    }))
    .filter(({ rel }) => !rel.startsWith('resolvers/gradle/'))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  test('shouldNotImportGradleResolverOutsideRegistry', () => {
    const offenders = allRelCode
      .filter(({ rel }) => rel !== 'resolvers/index.ts')
      .filter(({ code }) => /resolvers\/gradle\b/.test(code))
      .map(({ rel }) => rel);

    const unexpected = offenders.filter((rel) => !(rel in GRADLE_IMPORT_ALLOWLIST));
    const stale = Object.keys(GRADLE_IMPORT_ALLOWLIST).filter((rel) => !offenders.includes(rel));

    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
  });

  test('shouldNotReferenceGradleOutsideAllowlist', () => {
    const matching = allRelCode
      .filter(({ code }) => /gradle/i.test(code))
      .map(({ rel }) => rel);

    const unexpected = matching.filter((rel) => !(rel in GRADLE_REFERENCE_ALLOWLIST));
    const stale = Object.keys(GRADLE_REFERENCE_ALLOWLIST).filter((rel) => !matching.includes(rel));

    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
  });

  test('stripCommentsPreservingStrings removes comments without mangling URLs in strings', () => {
    const sample = [
      '// gradle in line comment',
      '/* gradle in block comment */',
      'const u = "https://example.com/gradle-url";',
    ].join('\n');
    const stripped = stripCommentsPreservingStrings(sample);
    expect(stripped).not.toContain('line comment');
    expect(stripped).not.toContain('block comment');
    expect(stripped).toContain('https://example.com/gradle-url');
  });
});
