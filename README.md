# jvmsrc — Give your coding agent a Java IDE

<div align="center">

[![CI](https://github.com/Sintexer/jvm-source-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/Sintexer/jvm-source-lens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/jvmsrc)](https://www.npmjs.com/package/jvmsrc)
[![License: MIT](https://img.shields.io/github/license/Sintexer/jvm-source-lens)](https://github.com/Sintexer/jvm-source-lens/blob/master/LICENSE)
[![Node](https://img.shields.io/node/v/jvmsrc)](https://www.npmjs.com/package/jvmsrc)

**An MCP server and CLI** that gives your coding agent the one thing it is missing on JVM codebases: **the actual classpath**.

</div>

Your IDE knows which library version your build uses. Your coding agent does not. It guesses from `~/.gradle/caches` and often reads the wrong JAR.
`jvmsrc` asks your build tool (Gradle) for the resolved classpath. Then it gives the agent **real source**, **real signatures** and **real structure** for the exact version in use.

---

## Quick Start

Requires **Node ≥ 20** and **Java on `PATH`** (for the CFR decompiler and `javap`).

### 1. Add the MCP server — run in your terminal

```bash
claude mcp add jvmsrc -- npx -y jvmsrc mcp
```

<details>
<summary><strong>Other clients (Cursor, Windsurf, VS Code, any MCP host)</strong></summary>

Add this to the MCP config of your client, then restart the client:

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

VS Code (`mcp.json`) uses the key `servers` instead of `mcpServers`.

To install the CLI globally, run `npm install -g jvmsrc`. Then use `"command": "jvmsrc"` and `"args": ["mcp"]`.
`jvmsrc config` prints a paste-ready block with environment hints.

</details>

### 2. Check it works — type in your agent chat, not in the terminal

> *"Use jvmsrc: which methods does `<a library class from your project>` declare?"*

The first call runs Gradle (about 5–10 s). Later calls use the cache.

### 3. Make your agent use it

Agents often prefer `Bash` and `javap` out of habit. Add this rule to `CLAUDE.md`, `AGENTS.md` or your Cursor rules:

```markdown
## Dependencies (jvmsrc)
For any question about a third-party library class, method or version, use the jvmsrc MCP tools
(search_classes → get_class_structure → get_class_source with methodNames; resolve_dependencies for versions).
When working inside one module, pass modulePath (':app' or the file you are editing) to get that module's versions.
Never use javap, unzip/jar on JARs, or ~/.gradle/caches. Code under this repo's src/ → grep/read as usual.
```

Details, and an optional Claude Code hook that blocks the shell fallbacks: [Make your agent use it](#make-your-agent-use-it).

<p align="center">
  <img src="docs/assets/jvmsrc-demo.gif" alt="jvmsrc resolving a Spring class in Claude Code" width="100%" />
  <br />
  <em>Claude Code resolving HandlerInterceptor signatures via jvmsrc — 3 calls, correct answer, no cache walking.</em>
</p>

---

## Why jvmsrc

Question: *"Does `AbstractTradingService` have a public helper we can reuse in our override?"* (a private library, no public Javadoc)

| | Without `jvmsrc` | With `jvmsrc` |
|:---|:---|:---|
| **Agent turns** | ~25 | 3 |
| **How it works** | `find ~/.gradle`, then `jar tf` and `javap` on a JAR it picked by guess | `search_classes` → `get_class_structure` → `get_method_signature` |
| **Version used** | Wrong (`2.4.1`, the project uses `3.0.0-SNAPSHOT`) | The one Gradle resolved |
| **Result** | "No helper exists, write your own" | Finds `maskSensitiveFields()`, correct override on the first try |

Typical result on JVM projects with private libraries (author's own use, not a benchmark):

* About **50K tokens saved** per "what is on this external class" question.
* Far fewer agent loops that walk Gradle caches, open wrong JARs or give up.
* Tasks that touch internal SDKs become safe to delegate.

### How it works

1. **Build tool query:** `jvmsrc` asks your build tool (Gradle) for the exact resolved classpath.
2. **Cache:** it caches the result and watches your build files, so the data stays current.
3. **Small tools:** it exposes precise tools (signatures, structure, search) instead of full-source dumps. Context stays small.

---

## Tools your agent gets

The MCP server runs over stdio (`jvmsrc mcp`). It needs no environment variables by default.

| Tool | What it does |
|:---|:---|
| **`search_classes`** | Find a class by simple name or glob; returns compact FQN + lib name lists |
| **`get_class_structure`** | Retrieves class overview (purpose + method names) or declared signatures |
| **`get_method_signature`**| Fetches real overloads for a method, with parameter names and generics |
| **`find_in_class_source`**| Performs regex or substring searches inside a resolved class |
| **`get_class_source`** | Retrieves method bodies or line ranges (used as a last resort) |
| **`search_in_artifact`** | Greps text across all classes in one resolved dependency JAR |
| **`resolve_dependencies`**| Analyzes the actual dependency graph this project uses |

> [!TIP]
> Every source response includes `sourceAvailable`: `true` for real sources (Javadoc, parameter names, generics), `false` for CFR decompilation (structure reliable, names may be synthetic).

> [!NOTE]
> **Multimodule:** omit `modulePath` and jvmsrc auto-picks the unique owning module; on a miss it lists candidate `modulePath`s. **Methods:** `search_classes` matches declared method names when the index has source enrichment; for body text in a known JAR use `search_in_artifact`. `get_class_source` `methodNames` also walks superclasses for unmatched names.

> [!NOTE]
> **Inputs are forgiving.** `projectRoot` can be omitted (the workspace is used, or set `JVMSRC_PROJECT_ROOT`); `modulePath` accepts `app`, `/app`, `:app`, or a file/directory inside the module (omit it, or pass `"*"`, to search all modules); `className` accepts a simple name, `Outer.Inner`, or a trailing `.class`/`.java`. Pass `forceRefresh: true` only after something changed that the build files do not show, such as a SNAPSHOT republish.

### Private repository credentials (optional)

Only needed when your Gradle build requires credential env vars for a private Maven/Artifactory/Nexus-style repo. MCP hosts often do **not** inherit your interactive shell, so set those vars on the **jvmsrc MCP process** (then restart the server).

`REPO_USER` / `REPO_PASS` below are **sample names only** — jvmsrc does not require them. Use the variable names your Gradle scripts document:

```json
{
  "mcpServers": {
    "jvmsrc": {
      "command": "jvmsrc",
      "args": ["mcp"],
      "env": {
        "REPO_USER": "your-username",
        "REPO_PASS": "your-password"
      }
    }
  }
}
```

Omit the `env` block when the project does not need it.

---

## Make your agent use it

Tool descriptions help, but a built-in `Bash` tool the agent already trusts often wins. Two small additions make `jvmsrc` the default for dependency questions.

**1. Rule in the agent instructions.** Use the block from [Quick Start](#3-make-your-agent-use-it). Many clients do not show MCP server `instructions` at all.

**2. (Claude Code) Hook that blocks shell fallbacks.** [`docs/hooks/block-jvm-fallbacks.mjs`](docs/hooks/block-jvm-fallbacks.mjs) denies `javap`, `unzip`/`jar` on JARs, and `~/.gradle/caches` / `~/.m2` access. It tells the agent to use `jvmsrc` instead. Save the script in a stable place. Add this to `.claude/settings.json` (project) or `~/.claude/settings.json` (all projects):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node /absolute/path/to/block-jvm-fallbacks.mjs" }]
      }
    ]
  }
}
```

Set `JVMSRC_HOOK_DISABLE=1` to switch it off for a while. Other clients have their own hook systems; read their current docs before you port it.

**Check that your client shows the server instructions:** ask the agent *"What instructions does the jvmsrc MCP server give?"*. If it cannot answer, rely on the rule in step 1.

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

Primarily **Java + Spring Boot** projects on Gradle. Other JVM languages (Kotlin, Scala) and Android work today on a best-effort basis and are on the roadmap as first-class targets — see [PLAN.md](PLAN.md).

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

Composite builds, Android-only layouts, and exotic configurations are not fully validated. See [PLAN.md](PLAN.md).

</details>

<details>
<summary>Security & Privacy</summary>

* **No telemetry.**
* **Local only** — caches and diagnostics stay on disk; never writes under your project root.
* **Subprocesses** via argv only (no shell interpolation) — see [SECURITY.md](SECURITY.md).
* Optional `JVMSRC_ALLOWED_ROOTS` to lock down which projects jvmsrc may resolve.
* **Files it writes:** the cache, config and log folders only (OS defaults from [`env-paths`](https://www.npmjs.com/package/env-paths); see [Environment Variables](#detailed-reference)). It does **not** edit your agent config, `CLAUDE.md` or hooks. You add those yourself.

**Uninstall**

```bash
claude mcp remove jvmsrc        # Claude Code. Other clients: delete the "jvmsrc" entry from the MCP config
npm uninstall -g jvmsrc         # only if you installed it globally
```

Then delete the jvmsrc cache folder (`JVMSRC_CACHE_ROOT`, or the OS default), the rule block in your agent instructions and the hook entry, if you added them.

</details>

<details>
<summary>CLI Command Reference</summary>

```bash
jvmsrc com.example.MyClass -p /path/to/gradle-project          # shorthand for get
jvmsrc get com.example.MyClass -p /path/to/project -q > MyClass.java
jvmsrc resolve -p /path/to/project --force-refresh
jvmsrc config jdk-roots add /path/to/jdks                      # one-time JDK roots setup
jvmsrc doctor java -p /path/to/project                         # check JDK requirement + selection
jvmsrc diagnostics last                                         # latest failure message
jvmsrc mcp                                                     # run as MCP server
```

**Useful flags:** `-p` / `--project`, `--module` (`:core:api`), `--configuration`, `--include-test`, `--force-refresh`, `--verbose` (Gradle stderr only), `--method`, `--start-line` / `--end-line`.

**Repo fixture for testing:**
`test/fixtures/gradle-smoke` —
`jvmsrc get com.smoke.Core -p test/fixtures/gradle-smoke --module :core`.

</details>

<details>
<summary>Troubleshooting</summary>

* **Resolution failures:** Run `jvmsrc diagnostics last` (or `jvmsrc diagnostics last 5`)
* **Custom JDK install roots:** Add once with `jvmsrc config jdk-roots add /path/to/jdks`
* **JDK mismatch debugging:** Run `jvmsrc doctor java -p /path/to/project`
* **After upgrading jvmsrc:** Restart your MCP host
* **Stale classpath:** Run `jvmsrc resolve --force-refresh`
* **Tool-usage analysis:** Set `JVMSRC_CALL_LOG=1` in the MCP server `env`; calls are logged to `calls.log` next to the failure log (macOS: `~/Library/Logs/jvmsrc/`)

</details>

<details>
<summary>Environment Variables</summary>

| Variable | Purpose |
|---|---|
| `JVMSRC_JAVA_HOME` | Force JDK home for Gradle/CFR child processes |
| `JVMSRC_CONFIG_DIR` | Global jvmsrc config directory (absolute) |
| `JVMSRC_CACHE_ROOT` | Cache root (absolute) |
| `JVMSRC_LOG_DIR` | Diagnostic logs (absolute) |
| `JVMSRC_CALL_LOG` | `1` = append one line per MCP tool call to `calls.log` (opt-in; see SPEC §6.3) |
| `JVMSRC_ALLOWED_ROOTS` | Allowed `projectRoot` prefixes |
| `JVMSRC_PROJECT_ROOT` | Default project root for MCP tools when `projectRoot` is omitted and the client sends no workspace roots (falls back to the working directory) |
| `JVMSRC_MAX_SOURCE_OUTPUT_CHARS` | Max source body size (default 524288) |
| `JVMSRC_GRADLE_TIMEOUT_MS` | Gradle timeout |
| `JVMSRC_USE_SYSTEM_GRADLE` | `1` = run `gradle` on `PATH`, not the project's `./gradlew` (see [SECURITY.md](SECURITY.md#gradle-wrapper-trust)) |
| `JVMSRC_MAX_JAR_BYTES` | Max size of a JAR read into memory (default 524288000 = 500 MB); larger JARs return `ZIP_READ_ERROR` |
| `JVMSRC_REGEX_TIMEOUT_MS` | Wall-clock limit for regex mode in `find_in_class_source` / `search_in_artifact` (default 2000) |
| `JVMSRC_CFR_PATH` | Custom CFR JAR |

Defaults follow [`env-paths`](https://www.npmjs.com/package/env-paths) conventions per OS. Full layout: [SPEC.md](SPEC.md) §6.

When `JVMSRC_JAVA_HOME` is not set, jvmsrc auto-discovers local JDKs from common paths such as `~/.jdks` (IntelliJ), `~/.gradle/jdks`, SDKMan, jenv, asdf, and OS-specific system install directories, plus your global configured JDK roots from `jvmsrc config jdk-roots ...`.

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
| [PLAN.md](PLAN.md) | Status and checkpoint plan |
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
