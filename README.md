# JVM Source Lens (`jvmsrc`)

Resolve a JVM project's **actual classpath** through Gradle, then read Java source, signatures, and structure for any class on that classpath — with the **version your project uses**, not whatever happens to sit in `~/.gradle/caches`.

Built for **CLI** use and **MCP** agents (Cursor, Claude Desktop, Windsurf, etc.).

## Why not grep `~/.gradle`?

Global caches hold many versions of every library. Picking a JAR by name or path is guesswork. **jvmsrc asks the build tool**, then reads artifacts from that answer. If resolution fails, you get an error — not a silent wrong version.

## Requirements

- **Node.js ≥ 20** (runtime)
- A **Gradle** project (`gradlew` or `gradle` on `PATH`)
- **Java** on `PATH` (for decompilation and `javap`)

## Install

```bash
npm install -g jvmsrc
# or
npx jvmsrc <command>
```

From source (development):

```bash
bun install
bun run setup:cfr    # once — downloads bundled CFR
bun run build
node dist/cli.js get com.example.Foo -p /path/to/project
```

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

## Environment variables

| Variable | Purpose |
|----------|---------|
| `JVMSRC_CACHE_ROOT` | Override resolution/decompile cache (absolute path) |
| `JVMSRC_LOG_DIR` | Override failure diagnostic logs (absolute path) |
| `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` | Custom CFR JAR |
| `JVMSRC_GRADLE_TIMEOUT_MS` | Gradle wall-clock timeout |

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
| [CLAUDE.md](CLAUDE.md) | Contributor / agent notes for this repository |

## License

MIT — see [LICENSE](LICENSE) if present in the repository.
