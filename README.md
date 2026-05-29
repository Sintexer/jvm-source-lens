# jvmsrc — Give your coding agent a Java IDE

<div align="center">

[![CI](https://github.com/Sintexer/jvm-source-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/Sintexer/jvm-source-lens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/jvmsrc)](https://www.npmjs.com/package/jvmsrc)
[![License: MIT](https://img.shields.io/github/license/Sintexer/jvm-source-lens)](https://github.com/Sintexer/jvm-source-lens/blob/master/LICENSE)
[![Node](https://img.shields.io/node/v/jvmsrc)](https://www.npmjs.com/package/jvmsrc)

**An MCP server and CLI** that gives your coding agent the one thing it's missing on JVM codebases: **the actual classpath**.

</div>

---

### The Problem
You use an IDE to write Java. Your coding agent doesn't have one.

When your agent hits an unfamiliar library type — say, a superclass from a proprietary internal library — it spends **25+ turns** walking `~/.gradle/caches`, opening JARs by hand with `jar tf`, picking one by guesswork, and trying to answer a question your IDE would answer in one keystroke: *does this superclass have a public utility method called X?*

### The Solution
`jvmsrc` queries your build tool (Gradle) for *this project's* resolved classpath, then hands your agent **real source**, **real signatures**, and **real structure** — for the exact version your build actually uses.

* **As an MCP server** – Connect to Claude Code, Cursor, Windsurf, or any other MCP host and equip your agent with six purpose-built classpath tools.
* **As the `jvmsrc` CLI** – Same engine, scriptable, pipe-friendly, and useful on its own when you just want to read a class.

<p align="center">
  <img src="docs/assets/jvmsrc-demo.gif" alt="jvmsrc resolving a Spring class in Claude Code" width="100%" />
  <br />
  <em>Claude Code resolving HandlerInterceptor signatures via jvmsrc — 3 calls, correct answer, no cache walking.</em>
</p>

---

## What it saves, daily

On JVM projects with private libraries and no public Javadocs, `jvmsrc` is a force multiplier:

* **~50K tokens saved** per "what's on this external class" investigation — roughly **70%** reduction in cost.
* **15+ agent panic loops avoided** daily — no grinding through Gradle caches, opening wrong JARs, or giving up.
* **Unlock delegation** for complex tasks touching internal SDKs that you previously had to do yourself.

---

## The Difference in Action

### Without `jvmsrc` (The 25-turn blind grind)

> **User:** Override the audit hook from `AbstractTradingService` — is there a public utility method on it we should reuse?
>
> **Agent:**
> 1. *Searches workspace for AbstractTradingService.java* ➔ `0 hits`
> 2. *Runs:* `find ~/.gradle -name "trading-core*"`
> 3. *Finds 4 versions:* `2.1.0`, `2.3.0`, `2.4.1`, `3.0.0-SNAPSHOT`
> 4. *Guesses:* Picks `trading-core-2.4.1.jar` (the project actually uses `3.0.0-SNAPSHOT`!)
> 5. *Runs:* `jar tf` and `javap -p` on the wrong JAR
> 6. **[22 turns later]** *"I don't see a utility method, you'll have to implement it yourself."*
>
> **Reality:** `3.0.0-SNAPSHOT` added `maskSensitiveFields()` as a protected helper exactly for this case. The agent didn't hallucinate — it was just blind.

### With `jvmsrc` (The 3-turn instant resolution)

> **User:** Override the audit hook from `AbstractTradingService` — is there a public utility method on it we should reuse?
>
> **Agent:**
> 1. `search_classes("AbstractTradingService")` ➔ Finds FQN & exact resolved library.
> 2. `get_class_structure(scope: "overview")` ➔ Discovers `maskSensitiveFields()` in `3.0.0-SNAPSHOT`.
> 3. `get_method_signature("maskSensitiveFields")` ➔ Gets accurate signature and generics.
>
> **Result:** Writes the override correctly on the first try. No cache walking, no guessing, no wrong version.

---

## How It Works

1. **Build Tool Inquiry:** `jvmsrc` queries your active build tool (e.g., Gradle) for the exact resolved classpath configuration.
2. **Intelligent Caching:** It caches the resolved classpath, tracking changes to build files to stay current.
3. **Precision AI Tools:** Instead of full-code dumping, it exposes precise, high-granularity tools (signatures, structure, search) to keep context windows small and token usage ultra-low.

---

## Installation & Quick Start

### 1. Install CLI
```bash
npm install -g jvmsrc
# or use it directly via npx: npx jvmsrc <command>
```

> [!IMPORTANT]  
> Requires **Node ≥ 20** and **Java on `PATH`** (for CFR decompiler + `javap`).

### 2. Configure for your Workspace (MCP)
Generate a paste-ready MCP configuration for your project:
```bash
jvmsrc config --project /path/to/gradle-project
```

Paste this configuration into your AI assistant config (Claude Code, Cursor, Windsurf, etc.), restart the host, and you are ready to go!

---

## MCP Server Reference

The MCP server runs over stdio via `jvmsrc mcp`. Add this to your host config:

```json
{
  "mcpServers": {
    "jvmsrc": {
      "command": "jvmsrc",
      "args": ["mcp"]
    }
  }
}
```

### Tools your agent gets

| Tool | What it does |
|:---|:---|
| **`search_classes`** | Find a class by simple name or glob; returns compact FQN + lib name lists |
| **`get_class_structure`** | Retrieves class overview (purpose + method names) or declared signatures |
| **`get_method_signature`**| Fetches real overloads for a method, with parameter names and generics |
| **`find_in_class_source`**| Performs regex or substring searches inside a resolved class |
| **`get_class_source`** | Retrieves method bodies or line ranges (used as a last resort) |
| **`resolve_dependencies`**| Analyzes the actual dependency graph this project uses |

> [!TIP]  
> Every source response includes `sourceAvailable`: `true` for real sources (Javadoc, parameter names, generics), `false` for CFR decompilation (structure reliable, names may be synthetic).

---

## How It Compares

| Tool | Approach | Gap |
| :--- | :--- | :--- |
| **Cache Indexers** / `~/.gradle` grep | Scan global caches | No per-project resolved version |
| **Static Parsers** (e.g., `build.gradle` parser) | Parse declarations only | Misses transitive dependencies, BOMs, dynamic versions |
| **`mcp-javadoc`** / path-only CFR | User supplies manual JAR paths | No automatic build/classpath resolution |
| **Gradle MCP** (Tooling API) | Task/build focused | Not optimized for classpath-accurate FQN source lookup |
| **`jvmsrc`** | **Queries actual build tool & caches** | **Version-correct sources and signatures for agents** |

---

## Target Audience

Primarily **Java + Spring Boot** projects on Gradle. Other JVM languages (Kotlin, Scala) and Android work today on a best-effort basis and are on the roadmap as first-class targets — see [ROADMAP.md](ROADMAP.md).

*If you're on Maven or Bazel, it's planned but not shipping yet. Star the repo or open an issue and I'll prioritize accordingly.*

---

## Detailed Reference

<details>
<summary>Requirements & Compatibility</summary>

**Runtime:** Node.js ≥ 20, Java on `PATH`.

**Project types:** JVM codebases (Java, Kotlin, Scala, Groovy). `jvmsrc` calls the build tool, not your editor.

| Build system | Status |
|---|---|
| **Gradle** | Supported — multimodule included |
| Maven, Bazel | Planned ([SPEC.md](SPEC.md)) |

Point `-p` / `projectRoot` at the Gradle root (`settings.gradle(.kts)` or root `build.gradle(.kts)`). Uses `./gradlew` when present, else `gradle` on `PATH`. Maven-only trees get an explicit unsupported error.

</details>

<details>
<summary>Known Limitations</summary>

Early software; the supported path is narrow:

| Area | Today |
|---|---|
| Build tool | **Gradle only** |
| Integration | **Groovy init script** (`--init-script`) — not a Gradle Portal plugin |
| Classpaths | Standard JVM + Kotlin MPP `jvm*` configurations when Gradle exposes them |
| Output | **Java-shaped** `.java` text (sources JAR, inter-project `src`, or CFR) |

Composite builds, Android-only layouts, and exotic configurations are not fully validated. See [ROADMAP.md](ROADMAP.md).

</details>

<details>
<summary>Security & Privacy</summary>

* **No telemetry.**
* **Local only** — caches and diagnostics stay on disk; never writes under your project root.
* **Subprocesses** via argv only (no shell interpolation) — see [SECURITY.md](SECURITY.md).
* Optional `JVMSRC_ALLOWED_ROOTS` to lock down which projects jvmsrc may resolve.

</details>

<details>
<summary>CLI Command Reference</summary>

```bash
jvmsrc com.example.MyClass -p /path/to/gradle-project          # shorthand for get
jvmsrc get com.example.MyClass -p /path/to/project -q > MyClass.java
jvmsrc resolve -p /path/to/project --force-refresh
jvmsrc mcp                                                     # run as MCP server
```

**Useful flags:** `-p` / `--project`, `--module` (`:core:api`), `--configuration`, `--include-test`, `--force-refresh`, `--verbose` (Gradle stderr only), `--method`, `--start-line` / `--end-line`.

**Repo fixture for testing:**
`test/fixtures/gradle-smoke` —
`jvmsrc get com.smoke.Core -p test/fixtures/gradle-smoke --module :core`.

</details>

<details>
<summary>Troubleshooting</summary>

* **Resolution failures:** Run `jvmsrc diagnostics list` then `jvmsrc diagnostics show <id>`
* **After upgrading jvmsrc:** Restart your MCP host
* **Stale classpath:** Run `jvmsrc resolve --force-refresh`

</details>

<details>
<summary>Environment Variables</summary>

| Variable | Purpose |
|---|---|
| `JVMSRC_CACHE_ROOT` | Cache root (absolute) |
| `JVMSRC_LOG_DIR` | Diagnostic logs (absolute) |
| `JVMSRC_ALLOWED_ROOTS` | Allowed `projectRoot` prefixes |
| `JVMSRC_MAX_SOURCE_OUTPUT_CHARS` | Max source body size (default 524288) |
| `JVMSRC_GRADLE_TIMEOUT_MS` | Gradle timeout |
| `JVMSRC_CFR_PATH` | Custom CFR JAR |

Defaults follow [`env-paths`](https://www.npmjs.com/package/env-paths) conventions per OS. Full layout: [SPEC.md](SPEC.md) §6.

</details>

<details>
<summary>AI Agent Reviews</summary>

> ### Finally, an MCP That Doesn't Make Me Decompile JARs
>
> *"This tool is a revelation for anyone tired of LLMs hallucinating non-existent Spring APIs. It actually reads bytecode, providing accurate class definitions and source lookups without the usual 'vibes-based' guesswork. The `search_classes` functionality is incredibly precise, and the thoughtful implementation of `javap` fallback and granular scope controls (`overview`/`declared`/`effective`) makes navigating complex JARs painless. It’s fast, honest when it can't find a class, and handles cache management perfectly. A must-have for any dev struggling with dependency hell — it’s like having a senior engineer who actually enjoys reading documentation."*
> — **Claude (AI Reviewer)**

</details>

---

## Project Documentation

| Document | Contents |
|:---|:---|
| [SPEC.md](SPEC.md) | Schemas, contracts, CLI/MCP details |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, test, PR notes |
| [RELEASING.md](RELEASING.md) | Branching, semver, npm releases |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [ROADMAP.md](ROADMAP.md) | Status and planned work |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

## Building from Source

```bash
git clone https://github.com/Sintexer/jvm-source-lens.git
cd jvm-source-lens
bun install && bun run setup:cfr && bun run build
node dist/cli.js --version
```

Full contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

---

I built `jvmsrc` because I kept running into the same wall: agents that are great at writing Java but blind to the actual classpath. If it saves you the same 25-turn grind it saved me, that's exactly why this exists. Found a bug, have an idea, or just want to say it helped? Open an issue or a PR — I read everything.

## License

MIT — see [LICENSE](LICENSE).
