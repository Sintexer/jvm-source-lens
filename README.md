# JVM Source Lens (`jvmsrc`)

Resolve a JVM project's **actual classpath** through Gradle, then read Java source, signatures, and structure for any class on that classpath — with the **version your project uses**, not whatever happens to sit in `~/.gradle/caches`.

Built for **CLI** use and **MCP** agents (Cursor, Claude Desktop, Windsurf, etc.).

## Why not grep `~/.gradle`?

Global caches hold many versions of every library. Picking a JAR by name or path is guesswork. **jvmsrc asks the build tool**, then reads artifacts from that answer. If resolution fails, you get an error — not a silent wrong version.

## Compared to similar tools

| Tool | Approach | Gap |
|------|----------|-----|
| Cache indexers / `~/.gradle` grep | Scan global caches | No per-project resolved version |
| Static `build.gradle` parsers | Parse declarations only | Miss transitives, BOMs, dynamic versions |
| `mcp-javadc` / path-only CFR | User supplies JAR paths | No Gradle resolution |
| Gradle MCP (tooling API) | Task/build focused | Not classpath-accurate source for arbitrary FQNs |
| **jvmsrc** | **`gradlew` + init script → resolved graph** | **Version-correct source/signatures for agents** |

## Requirements

- **Node.js ≥ 20** (runtime)
- A **Gradle** project (`gradlew` or `gradle` on `PATH`)
- **Java** on `PATH` (for decompilation and `javap`)

## Install

### Published package (npm)

```bash
npm install -g jvmsrc
# or per-invocation
npx jvmsrc <command>
```

Requires **Node.js ≥ 20** only. The published tarball ships prebuilt `dist/` and bundled `resources/`.

### From source — npm only (Node ≥ 20)

Use this when you want a standard Node toolchain and do **not** need Bun. You build to `dist/` and run the compiled CLI.

```bash
git clone https://github.com/Sintexer/jvm-dependency-resolver.git
cd jvm-dependency-resolver

npm ci                    # or: npm install
npm run setup:cfr         # once — downloads CFR into resources/cfr.jar
npm run build             # esbuild → dist/ (--target=node20)
npm run validate:resources

# Run without installing globally
node dist/cli.js get com.example.Foo -p /path/to/gradle-project
node dist/cli.js mcp

# Optional: install `jvmsrc` on your PATH from this checkout
npm link
jvmsrc get com.example.Foo -p /path/to/gradle-project
jvmsrc config --project /path/to/gradle-project   # MCP snippet → dist/cli.js mcp
```

| Task | npm-only command |
|------|------------------|
| Typecheck | `npm run typecheck` |
| Production-like build | `npm run build` |
| Verify bundle layout (pre-publish) | `npm run prepack` |
| Tests | Requires [Bun](https://bun.sh) — `bun test` (see Bun flow below) |

`npm run setup:cfr` uses `tsx` from devDependencies; no Bun required for build or runtime.

### From source — Bun (contributors)

Use this for day-to-day development: run TypeScript directly, fast tests, no rebuild between edits.

```bash
git clone https://github.com/Sintexer/jvm-dependency-resolver.git
cd jvm-dependency-resolver

bun install
bun run setup:cfr         # same script as npm; needs resources/cfr.jar once

# Iterate on source (no dist/ rebuild)
bun run dev:cli -- get com.example.Foo -p /path/to/project
bun run dev:mcp

# Or invoke the CLI entry directly
bun run src/cli.ts get com.example.Foo -p /path/to/project
bun run src/cli.ts config --project /path/to/gradle-project   # MCP snippet → bun run src/mcp.ts

bun test                  # full suite
bun test src/foo.test.ts
bun run typecheck
```

When you need a production bundle (e.g. `npm pack`, comparing with published behavior):

```bash
npm run build             # esbuild (default for prepack)
# or
bun run build:bun         # optional: Bun bundler instead of esbuild
node dist/cli.js --version
```

| Task | Bun-oriented command |
|------|----------------------|
| Dev CLI | `bun run dev:cli -- …` |
| Dev MCP | `bun run dev:mcp` |
| Tests | `bun test` |
| Gradle smoke wrapper (local Gradle runs) | `bun run ensure:gradle-smoke-wrapper` |

**MCP from a dev checkout:** `jvmsrc config` detects when it was run via `bun …/src/cli.ts` and emits `bun run …/src/mcp.ts` in the JSON snippet; after `npm link` + `npm run build` it emits `jvmsrc mcp` instead.

## Example (fixture project)

The repo includes a small multimodule Gradle smoke tree under `test/fixtures/gradle-smoke`. After a build (`npm run build`) or via Bun dev (`bun run dev:cli --`):

```bash
# From source without `npm link`, prefix with `node dist/cli.js` or `bun run dev:cli --`

# Warm resolution cache (prints ResolutionOutput JSON)
jvmsrc resolve -p test/fixtures/gradle-smoke

# Full source for an inter-project class (stdout = .java)
jvmsrc get com.smoke.Core -p test/fixtures/gradle-smoke --module :core

# Method excerpt only — avoids huge files in agent context
jvmsrc get com.smoke.Core -p test/fixtures/gradle-smoke --module :core \
  --method hello -q
```

Use MCP `get_method_signature` when you need overload listings without pulling the full file.

First run on a real project invokes Gradle once (often 5–30s); later calls reuse the resolution cache.

## Quick start (CLI)

```bash
# Full source for a class (stdout = .java, stderr = metadata JSON)
jvmsrc get com.example.MyClass -p /path/to/gradle-project

# Shorthand
jvmsrc com.example.MyClass -p /path/to/gradle-project

# Pipe-friendly: source only
jvmsrc get com.example.MyClass -p /path/to/project -q > MyClass.java

# Structured JSON on stdout (agents / scripts)
jvmsrc get com.example.MyClass -p /path/to/project --json

# Warm or refresh the resolution cache
jvmsrc resolve -p /path/to/project
jvmsrc resolve -p /path/to/project --force-refresh

# List submodules: `jvmsrc resolve` prints full ResolutionOutput (modules[].name)
```

Common flags: `-p` / `--project`, `--module` (e.g. `:core:api`), `--configuration`, `--include-test`, `--force-refresh`, `--verbose`. Excerpt: `--method` (repeatable; `<init>` for constructors), `--start-line` / `--end-line`.

## MCP setup

Generate a paste-ready config snippet:

```bash
jvmsrc config --project /path/to/gradle-project
```

Typical entry (after global install):

```json
{
  "mcpServers": {
    "jvmsrc": {
      "command": "npx",
      "args": ["-y", "jvmsrc", "mcp"]
    }
  }
}
```

Restart the MCP server after upgrading `jvmsrc`.

### Agent skill

For Cursor / Claude-style agents, use the bundled skill: **[SKILL.md](SKILL.md)** (copy into your agent skills folder or reference from project rules).

## MCP tools

| Tool | Use when |
|------|----------|
| `search_classes` | You don't know the FQN — substring or `*`/`?` glob on the resolved classpath |
| `get_method_signature` | Overloads, parameters, return types, `throws` (source-first; `bytecodeOnly: true` for strict javap) |
| `get_class_structure` | Fields, methods, hierarchy, annotations — without full source |
| `find_in_class_source` | Search inside one resolved class (literal or regex) |
| `get_class_source` | Full `.java` body, or excerpt via `methodNames` / line range (last resort for full file) |
| `resolve_dependencies` | Full dependency graph, submodule names (`modules[]`), warm cache |

Prefer **`get_method_signature`** or **`get_class_structure`** over **`get_class_source`** when signatures are enough.

Every source response includes **`sourceAvailable`**: `true` = original sources; `false` = CFR decompilation (structure reliable, names/Javadoc may be synthetic).

## How it works (short)

1. **Resolve** — `./gradlew` (or `gradle`) runs with a bundled init script; output is cached until build files change.
2. **Locate class** — inter-project `src/` first, then dependency JARs on the chosen classpath.
3. **Read source** — sources JAR when available; otherwise CFR decompile into a global cache (never written under your project tree).

## Local data (cache and diagnostics)

**Nothing is uploaded.** All data stays on your machine. The tool **never writes** under the Gradle project root for resolution (only reads it and runs Gradle with an external init script).

### Resolution and decompile cache

Override root: **`JVMSRC_CACHE_ROOT`** (must be absolute). Default uses [`env-paths`](https://www.npmjs.com/package/env-paths) for app id `jvmsrc`:

| OS | Default cache root |
|----|-------------------|
| macOS | `~/Library/Caches/jvmsrc` |
| Linux | `~/.cache/jvmsrc` |
| Windows | `%LOCALAPPDATA%\jvmsrc\Cache` |

Under that root:

| Path | Contents |
|------|----------|
| `projects/<8-char-id>/` | Per-project bucket (id = first 8 hex of SHA-256 of absolute project path) |
| `projects/<id>/resolution.json` | Last valid `ResolutionOutput` from Gradle |
| `projects/<id>/resolution.hash` | Digest of tracked build inputs (`build.gradle*`, `settings.gradle*`, version catalog, lockfiles) |
| `projects/<id>/bucket-meta.json` | Canonical project path + metadata |
| `projects/<id>/class-search-index.json` | Classpath FQN / search index for `search_classes` |
| `projects/<id>/jar-fqn-cache.json` | Reuse map for JAR FQN listings (mtime-sized) |
| `decompiled/<group>/<artifact>/<version>/<Class>.java` | Shared CFR output (keyed by Maven coordinates) |

Gradle’s own caches (`~/.gradle`) are used by Gradle as usual; jvmsrc does not replace them.

### Failure diagnostics

Override: **`JVMSRC_LOG_DIR`** (absolute). Default:

| OS | Default log root |
|----|-----------------|
| macOS | `~/Library/Logs/jvmsrc` |
| Linux | `$XDG_STATE_HOME/jvmsrc` or `~/.local/state/jvmsrc` |
| Windows | `%LOCALAPPDATA%\jvmsrc\Logs` |

Under `<log-root>/diagnostics/`: rolling JSON snapshots for failures (`jvmsrc diagnostics list|show`). Inputs are sanitized (no full environment dump).

## Security and privacy

- **No telemetry** — no network calls to report usage or source content.
- **Subprocesses** — Gradle, `java` (CFR), and `javap` only; argv-based spawn (**no shell** interpolation of user input). See [SECURITY.md](SECURITY.md).
- **Untrusted bytecode** — decompiling dependency JARs runs third-party bytecode locally; treat `sourceAvailable: false` as non-authoritative for security decisions.
- **`JVMSRC_ALLOWED_ROOTS`** — optional comma-separated absolute directories; reject `projectRoot` outside them (useful for locked-down MCP hosts).
- **Output cap** — full class source is truncated at **512 KiB** by default (`JVMSRC_MAX_SOURCE_OUTPUT_CHARS`); use method/line excerpts or structure tools for large types. Responses may include `outputTruncated: true` and `sourceLength`.

Full policy: [SECURITY.md](SECURITY.md).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `JVMSRC_CACHE_ROOT` | Override resolution/decompile cache (absolute path) |
| `JVMSRC_LOG_DIR` | Override failure diagnostic logs (absolute path) |
| `JVMSRC_ALLOWED_ROOTS` | Comma-separated allowed project roots (absolute) |
| `JVMSRC_MAX_SOURCE_OUTPUT_CHARS` | Max characters returned for one `get` / `get_class_source` body (default 524288) |
| `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` | Custom CFR JAR |
| `JVMSRC_GRADLE_TIMEOUT_MS` | Gradle wall-clock timeout |
| `JVMSRC_CFR_MAX_OUTPUT_BYTES` / `JVMSRC_JAVAP_MAX_OUTPUT_BYTES` | Subprocess capture limits |

See [SPEC.md](SPEC.md) for full behavior, error codes, and schemas.

## Troubleshooting

```bash
# Recent structured failure logs
jvmsrc diagnostics list
jvmsrc diagnostics show <diagnosticId>
```

On MCP errors after an upgrade: `bun run build` (or reinstall) and **restart** the MCP server.

## Documentation

| Document | Contents |
|----------|----------|
| [SPEC.md](SPEC.md) | Technical specification (schemas, contracts, CLI/MCP details) |
| [ROADMAP.md](ROADMAP.md) | Implementation status and planned work |
| [SKILL.md](SKILL.md) | Agent skill — when and how to use jvmsrc tools |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and trust boundary |
| [CLAUDE.md](CLAUDE.md) | Contributor / agent notes for this repository |

## License

MIT — see [LICENSE](LICENSE).
