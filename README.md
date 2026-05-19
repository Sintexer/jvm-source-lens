# JVM Source Lens (`jvmsrc`)

[![CI](https://github.com/Sintexer/jvm-dependency-resolver/actions/workflows/ci.yml/badge.svg)](https://github.com/Sintexer/jvm-dependency-resolver/actions/workflows/ci.yml)

Resolve a JVM project's **actual classpath** through Gradle, then read Java source, signatures, and structure for any class on that classpath — with the **version your project uses**, not whatever happens to sit in `~/.gradle/caches`.

Built for **CLI** use and **MCP** agents (Cursor, Claude Code, Windsurf, etc.).

**Contents:** [Why](#why-this-exists) · [How it works](#how-it-works) · [Requirements](#requirements) · [Limitations](#known-limitations) · [Install](#install) · [Quick start](#quick-start) · [MCP](#mcp) · [Security](#security-and-privacy) · [Troubleshooting](#troubleshooting) · [Building from source](#building-from-source)

## Why this exists

Coding agents on JVM codebases often hit a library type that is not in the workspace. A common failure mode: see an import, try to open the class in the repo, fail, then **panic** — sibling repos, `**/*.java` globs, `~/.gradle/caches` / `~/.m2` walks, or long shell chains (`find`, `jar tf`, `javap`), often on the **wrong JAR** because global caches hold many versions. In the worst case the agent guesses an API from the wrong artifact or from memory.

Even when something works, the cost is high: noisy output, many tool rounds, wasted tokens, and subprocesses on paths you did not mean to expose.

**jvmsrc** offers one path: **ask Gradle** for the resolved classpath for *this* project, then return source, signatures, or structure with provenance — or a clear error. Global cache directories are not a substitute: they store every version ever downloaded; only the build tool knows which one your module uses. Picking a JAR by name is guesswork; wrong output is worse than an error.

## How it works

1. **Resolve** — `gradlew` / `gradle` runs with a bundled Groovy init script; result is cached until build inputs change.
2. **Locate class** — inter-project `src/` first, then dependency JARs on the chosen classpath.
3. **Read** — sources JAR when available; otherwise CFR decompile into a **global** cache (nothing written under your project tree).

First resolution on a project is often 5–30s; later calls reuse the cache.

## Compared to similar tools

| Tool | Approach | Gap |
|------|----------|-----|
| Cache indexers / `~/.gradle` grep | Scan global caches | No per-project resolved version |
| Static `build.gradle` parsers | Parse declarations only | Miss transitives, BOMs, dynamic versions |
| `mcp-javadc` / path-only CFR | User supplies JAR paths | No Gradle resolution |
| Gradle MCP (tooling API) | Task/build focused | Not classpath-accurate source for arbitrary FQNs |
| **jvmsrc** | **`gradlew` + init script → resolved graph** | **Version-correct source/signatures for agents** |

## Requirements

**On your machine:** Node.js **≥ 20**, Java on `PATH` (CFR + `javap`). Bun is only for [developing jvmsrc](CONTRIBUTING.md).

**Project types:** JVM codebases (Java, Kotlin, Scala, Groovy, …). jvmsrc calls the **build tool**, not your editor.

| Build system | Status |
|--------------|--------|
| **Gradle** | Supported — multimodule included |
| Maven, Bazel, … | Planned ([SPEC.md](SPEC.md)) |

Point `-p` / `projectRoot` at the Gradle root (`settings.gradle(.kts)` or root `build.gradle(.kts)`). Uses `./gradlew` when present, else `gradle` on `PATH`. Maven-only trees get an explicit unsupported error.

## Known limitations

Early software; the supported path is narrow:

| Area | Today |
|------|--------|
| Build tool | **Gradle only** |
| Integration | **Groovy init script** (`--init-script`) — not a Gradle Portal plugin |
| Classpaths | Standard JVM + Kotlin MPP `jvm*` configurations when Gradle exposes them |
| Output | **Java-shaped** `.java` text (sources JAR, inter-project `src`, or CFR) |

Your repo may use `build.gradle` or `build.gradle.kts`; the **jvmsrc** side is still a **Groovy** init script. Composite builds, Android-only layouts, and exotic configurations are not fully validated. See [ROADMAP.md](ROADMAP.md).

## Install

```bash
npm install -g jvmsrc
# or
npx jvmsrc <command>
```

Published package includes prebuilt `dist/` and bundled CFR — **Node ≥ 20** only.

## Quick start

```bash
# Paste-ready MCP config (adjust project path)
jvmsrc config --project /path/to/gradle-project

# Class source (stdout = .java, stderr = metadata JSON)
jvmsrc get com.example.MyClass -p /path/to/gradle-project

# Shorthand, quiet pipe, or JSON
jvmsrc com.example.MyClass -p /path/to/gradle-project
jvmsrc get com.example.MyClass -p /path/to/project -q > MyClass.java
jvmsrc get com.example.MyClass -p /path/to/project --json

# Warm / refresh resolution cache
jvmsrc resolve -p /path/to/project
jvmsrc resolve -p /path/to/project --force-refresh
```

Useful flags: `-p` / `--project`, `--module` (`:core:api`), `--configuration`, `--include-test`, `--force-refresh`, `--verbose`, `--method`, `--start-line` / `--end-line`.

Repo fixture: `test/fixtures/gradle-smoke` — e.g. `jvmsrc get com.smoke.Core -p test/fixtures/gradle-smoke --module :core`.

## MCP

After install, a typical server entry:

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

Restart the MCP host after upgrading `jvmsrc`.

> **Agents:** copy or reference **[SKILL.md](SKILL.md)** in your agent rules.

### Tools

| Tool | Use when |
|------|----------|
| `search_classes` | Unknown FQN — substring or `*`/`?` glob on classpath |
| `get_method_signature` | Overloads / parameters / `throws` (`bytecodeOnly: true` for strict javap) |
| `get_class_structure` | Fields, methods, hierarchy — without full source |
| `find_in_class_source` | Search inside one class |
| `get_class_source` | Full body or excerpt (`methodNames`, line range) — last resort |
| `resolve_dependencies` | Dependency graph, `modules[]`, warm cache |

Prefer **`get_method_signature`** or **`get_class_structure`** over **`get_class_source`**. Every source response has **`sourceAvailable`**: `true` = real sources; `false` = CFR (structure OK, names/Javadoc may be synthetic).

## Security and privacy

- **No telemetry**
- **Local only** — caches and diagnostics on disk; never writes under the project root for resolution
- **Subprocesses:** Gradle, `java`, `javap` via argv (no shell interpolation) — [SECURITY.md](SECURITY.md)
- **`JVMSRC_ALLOWED_ROOTS`** — optional allowlist for `projectRoot`
- **Output cap** — 512 KiB default (`JVMSRC_MAX_SOURCE_OUTPUT_CHARS`); use excerpts or structure tools for large types

## Local data

Override with absolute paths: **`JVMSRC_CACHE_ROOT`** (resolution + decompile), **`JVMSRC_LOG_DIR`** (failure diagnostics).

Defaults (via [`env-paths`](https://www.npmjs.com/package/env-paths)): cache under `~/Library/Caches/jvmsrc` (macOS), `~/.cache/jvmsrc` (Linux), `%LOCALAPPDATA%\jvmsrc\Cache` (Windows); logs under `~/Library/Logs/jvmsrc`, `~/.local/state/jvmsrc`, or `%LOCALAPPDATA%\jvmsrc\Logs`.

Per-project buckets under `projects/<id>/` (`resolution.json`, search index, …) and shared `decompiled/<coordinates>/`. Gradle's `~/.gradle` is unchanged. Full layout: [SPEC.md](SPEC.md) section 6.

```bash
jvmsrc diagnostics list
jvmsrc diagnostics show <diagnosticId>
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `JVMSRC_CACHE_ROOT` | Cache root (absolute) |
| `JVMSRC_LOG_DIR` | Diagnostic logs (absolute) |
| `JVMSRC_ALLOWED_ROOTS` | Allowed `projectRoot` prefixes |
| `JVMSRC_MAX_SOURCE_OUTPUT_CHARS` | Max source body size (default 524288) |
| `JVMSRC_GRADLE_TIMEOUT_MS` | Gradle timeout |
| `JVMSRC_CFR_PATH` | Custom CFR JAR |

More (CFR/javap capture limits, error codes): [SPEC.md](SPEC.md).

## Troubleshooting

- Resolution failures: `jvmsrc diagnostics list` / `show <id>`
- After upgrade: reinstall or rebuild, then **restart** the MCP server
- Stale classpath: `jvmsrc resolve --force-refresh`

## Documentation

| Document | Contents |
|----------|----------|
| [SPEC.md](SPEC.md) | Schemas, contracts, CLI/MCP details |
| [SKILL.md](SKILL.md) | Agent skill |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, test, PR notes |
| [ROADMAP.md](ROADMAP.md) | Status and planned work |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

## Building from source

```bash
git clone https://github.com/Sintexer/jvm-dependency-resolver.git
cd jvm-dependency-resolver
npm run setup:cfr && npm ci && npm run build
node dist/cli.js --version
```

Contributor workflows (Bun dev loop, `prepack`, tests): **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## License

MIT — see [LICENSE](LICENSE).
