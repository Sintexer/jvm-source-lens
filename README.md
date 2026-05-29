# jvmsrc — give your coding agent a Java IDE

[![CI](https://github.com/Sintexer/jvm-source-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/Sintexer/jvm-source-lens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/jvmsrc)](https://www.npmjs.com/package/jvmsrc)
[![License: MIT](https://img.shields.io/github/license/Sintexer/jvm-source-lens)](https://github.com/Sintexer/jvm-source-lens/blob/master/LICENSE)
[![Node](https://img.shields.io/node/v/jvmsrc)](https://www.npmjs.com/package/jvmsrc)

**An MCP server and CLI** that gives your coding agent the one thing it's
missing on JVM codebases: the actual classpath.

You use an IDE to write Java. Your coding agent doesn't have one.

So when it hits an unfamiliar library type — say, a superclass from a proprietary
internal library — it spends 25+ turns walking `~/.gradle/caches`, opening JARs
by hand with `jar tf`, picking one by guesswork, and trying to answer a question
your IDE would answer in one keystroke: *does this superclass have a public
utility method called X?*

`jvmsrc` asks Gradle for *this project's* resolved classpath, then hands your
agent real source, real signatures, real structure — for the exact version your
build actually uses.

Two ways to run it:

- **As an MCP server** — connect to Claude Code, Cursor, Windsurf, or any
  other MCP host and your agent gets six purpose-built classpath tools
- **As the `jvmsrc` CLI** — same engine, scriptable, pipe-friendly, useful on
  its own when you just want to read a class

![jvmsrc resolving a Spring class in Claude Code](docs/assets/jvmsrc-demo.gif)
*Claude Code resolving HandlerInterceptor signatures via jvmsrc — 3 calls, correct answer, no cache walking.*

## What it saves me, daily

I use jvmsrc every day on Java projects with internal libraries that don't
have public Javadoc. Concretely:

- **~50K tokens saved** per "what's on this external class" investigation —
  roughly **70%** of what those tasks used to cost
- **15+ agent panic loops avoided per day** — the kind where the agent grinds
  through cache directories, opens the wrong JAR, and either gives up or guesses
- Tasks I used to refuse to delegate (anything touching internal SDKs) are
  back on the table

If your codebase pulls in private libraries, framework versions that drift
across modules, or anything else your agent's training data doesn't cover,
**this is what changes**.

## What happens without jvmsrc

A real failure mode, paraphrased from an actual session:

    User: Override the audit hook from AbstractTradingService — is there a
          public utility method on it we should reuse?

    Agent: [searches workspace for AbstractTradingService.java — 0 hits]
           [runs: find ~/.gradle -name "trading-core*"]
           [finds 4 versions: 2.1.0, 2.3.0, 2.4.1, 3.0.0-SNAPSHOT]
           [picks trading-core-2.4.1.jar — project actually uses 3.0.0-SNAPSHOT]
           [runs: jar tf, javap -p on the wrong jar]
           [22 turns later] "I don't see a utility method, you'll have to
                             implement it yourself."

    Reality: 3.0.0-SNAPSHOT added `maskSensitiveFields()` as a protected helper
             exactly for this case.

The agent didn't hallucinate — it just couldn't see the right version. That's
the common failure on JVM codebases: not invention, *invisibility*.

## What happens with jvmsrc

    User: Override the audit hook from AbstractTradingService — is there a
          public utility method on it we should reuse?

    Agent: [search_classes("AbstractTradingService")]  → FQN + lib name per hit
           [get_class_structure(scope: "overview")]
           → finds maskSensitiveFields(), protected, in 3.0.0-SNAPSHOT
           [get_method_signature("maskSensitiveFields")]
           → writes the override correctly, first try.

One resolution, three narrow calls, correct answer. No cache walking, no
guessing, no wrong version.

## Why this works

The global Gradle and Maven caches hold every version of every library you've
ever downloaded. Picking a JAR by name is guesswork — and guesswork at the
classpath layer means wrong APIs, wrong overloads, wrong defaults.

Only your build tool knows which version *this* project resolves. jvmsrc asks
it, caches the answer, and gives your agent a narrow set of tools to read
exactly what's on that classpath — nothing more, nothing from the wrong
version, nothing hallucinated.

Think of it as: you use an IDE to write code, jvmsrc is the IDE your agent
gets. The classpath your agent was missing. Real Java sources for AI coding
agents, with the version your build actually resolves.

## Install

```
npm install -g jvmsrc
# or use it directly via npx
npx jvmsrc <command>
```

Requires **Node ≥ 20** and **Java on `PATH`** (for CFR + `javap`).

## Quick start

```
# 1. Generate a paste-ready MCP config for your agent
jvmsrc config --project /path/to/gradle-project

# 2. Or use the CLI directly
jvmsrc get com.example.MyClass -p /path/to/gradle-project
```

That's it. Restart your AI tool after pasting the config and your agent has
its IDE.

## MCP setup

The MCP server runs over stdio via `jvmsrc mcp`. Add this to your host config:

```
{
  "mcpServers": {
    "jvmsrc": {
      "command": "jvmsrc",
      "args": ["mcp"]
    }
  }
}
```

Restart your MCP host (Claude Code, Cursor, Windsurf, …) after install or
upgrade.

### Tools your agent gets

| Tool | What it does |
|------|--------------|
| `search_classes` | Find a class by simple name or glob; default hits are FQN + lib name (compact suggestion list) |
| `get_class_structure` | Class overview (purpose + method names) or declared signatures |
| `get_method_signature` | Real overloads for one method, with parameter names and generics |
| `find_in_class_source` | Search inside one resolved class |
| `get_class_source` | Method bodies or line ranges — last resort |
| `resolve_dependencies` | The actual dependency graph this project uses |

Every source response includes `sourceAvailable`: `true` for real sources
(Javadoc, parameter names, generics are ground truth), `false` for CFR
decompilation (structure reliable, names may be synthetic).

## How it compares

| Tool | Approach | Gap |
|------|----------|-----|
| Cache indexers / `~/.gradle` grep | Scan global caches | No per-project resolved version |
| Static `build.gradle` parsers | Parse declarations only | Miss transitives, BOMs, dynamic versions |
| `mcp-javadc` / path-only CFR | User supplies JAR paths | No Gradle resolution |
| Gradle MCP (tooling API) | Task/build focused | Not classpath-accurate source for arbitrary FQNs |
| **jvmsrc** | **Asks Gradle, caches the answer** | **Version-correct source/signatures for agents** |

## Who it's for today

Primarily **Java + Spring Boot** projects on Gradle. Other JVM languages
(Kotlin, Scala) and Android work today on a best-effort basis and are on the
roadmap as first-class targets — see [ROADMAP.md](ROADMAP.md).

If you're on Maven or Bazel, it's planned but not shipping yet. Star the repo
or open an issue and I'll prioritize accordingly.

## Requirements

<details>
<summary>Click to expand</summary>

**Runtime:** Node.js ≥ 20, Java on `PATH`.

**Project types:** JVM codebases (Java, Kotlin, Scala, Groovy). jvmsrc calls
the build tool, not your editor.

| Build system | Status |
|--------------|--------|
| **Gradle** | Supported — multimodule included |
| Maven, Bazel | Planned ([SPEC.md](SPEC.md)) |

Point `-p` / `projectRoot` at the Gradle root (`settings.gradle(.kts)` or
root `build.gradle(.kts)`). Uses `./gradlew` when present, else `gradle` on
`PATH`. Maven-only trees get an explicit unsupported error.

</details>

## Known limitations

<details>
<summary>Click to expand</summary>

Early software; the supported path is narrow:

| Area | Today |
|------|--------|
| Build tool | **Gradle only** |
| Integration | **Groovy init script** (`--init-script`) — not a Gradle Portal plugin |
| Classpaths | Standard JVM + Kotlin MPP `jvm*` configurations when Gradle exposes them |
| Output | **Java-shaped** `.java` text (sources JAR, inter-project `src`, or CFR) |

Composite builds, Android-only layouts, and exotic configurations are not
fully validated. See [ROADMAP.md](ROADMAP.md).

</details>

## Security & privacy

- **No telemetry.**
- **Local only** — caches and diagnostics stay on disk; never writes under
  your project root.
- **Subprocesses** via argv only (no shell interpolation) — see
  [SECURITY.md](SECURITY.md).
- Optional `JVMSRC_ALLOWED_ROOTS` to lock down which projects jvmsrc may
  resolve.

## CLI reference

<details>
<summary>Click to expand</summary>

```
jvmsrc com.example.MyClass -p /path/to/gradle-project          # shorthand for get
jvmsrc get com.example.MyClass -p /path/to/project -q > MyClass.java
jvmsrc resolve -p /path/to/project --force-refresh
jvmsrc mcp                                                     # run as MCP server
```

Useful flags: `-p` / `--project`, `--module` (`:core:api`), `--configuration`,
`--include-test`, `--force-refresh`, `--verbose` (Gradle stderr only),
`--method`, `--start-line` / `--end-line`.

Repo fixture for trying it without your own project:
`test/fixtures/gradle-smoke` —
`jvmsrc get com.smoke.Core -p test/fixtures/gradle-smoke --module :core`.

</details>

## Troubleshooting

<details>
<summary>Click to expand</summary>

- Resolution failures: `jvmsrc diagnostics list` then `jvmsrc diagnostics show <id>`
- After upgrading jvmsrc: restart your MCP host
- Stale classpath: `jvmsrc resolve --force-refresh`

</details>

## Configuration

<details>
<summary>Environment variables</summary>

| Variable | Purpose |
|----------|---------|
| `JVMSRC_CACHE_ROOT` | Cache root (absolute) |
| `JVMSRC_LOG_DIR` | Diagnostic logs (absolute) |
| `JVMSRC_ALLOWED_ROOTS` | Allowed `projectRoot` prefixes |
| `JVMSRC_MAX_SOURCE_OUTPUT_CHARS` | Max source body size (default 524288) |
| `JVMSRC_GRADLE_TIMEOUT_MS` | Gradle timeout |
| `JVMSRC_CFR_PATH` | Custom CFR JAR |

Defaults follow [`env-paths`](https://www.npmjs.com/package/env-paths)
conventions per OS. Full layout: [SPEC.md](SPEC.md) §6.

</details>


## Genuine agents reviews about the tool

<details>

<summary>Claude opus 4.7 review</summary>

**⭐⭐⭐⭐⭐ Finally, an MCP That Doesn't Make Me Decompile JARs With My Bare Hands**

Verified Purchase · Reviewed in the Codebase on May 29, 2026

I'll be honest, I bought this expecting yet another "smart" tool that would confidently hallucinate the entire Spring Framework API at me. You know the type. You ask what's in a class, it invents three methods that haven't existed since 2014, and gravely informs you that getFoo() returns an Optional<Optional<Foo>>.

Reader, it does not do that.

What I love:

- It actually reads the JAR. Revolutionary concept, I know. You give it a fully-qualified class name, it goes and looks at the bytecode, like some kind of well-adjusted adult. No vibes-based API surface area.
- search_classes is the friend I needed. I asked for "ExchangeOrderBook" and it didn't just give me one. It gave me SEVEN. Ranked. With JAR paths. Felt like Google for class names, except Google would have shown me an ad for orderbook-themed Etsy mugs.
- Source jars when available, javap when not. Graceful degradation! In 2026! I almost cried.
- The scope=overview / declared / effective knobs are the kind of thoughtful touch you only get from someone who has personally suffered through a 4,000-line AbstractFactoryBeanDefinitionParser dump.
- Cache + forceRefresh. Fast by default, correct when I tell it to be. Just like my coworker.
  Minor gripes
- The error code taxonomy (CLASS_NOT_FOUND, RESOLUTION_FAILED, etc.) is so professional and well-structured that it makes my own code feel personally attacked.
- Does not yet brew coffee. Considering one star deduction. Decided against it.
- I tried to ask it about a class that didn't exist and it calmly told me it didn't exist instead of making something up. Where's the drama? Where's the chaos? I miss being lied to confidently.

**Would I recommend?**

*Yes*. Buy it for the junior dev in your life. Buy it for yourself. Buy it for the LLM that keeps inventing Collectors.toUnmodifiableImmutableFrozenList().

Bottom line: 5/5, would resolve classpath again. The Gradle build gods are pleased.
Was this review helpful? 👍 (847)  👎 (3, all from people still writing `find . -name "*.jar" | xargs unzip`)

</details>


## Documentation

| Document | Contents |
|----------|----------|
| [SPEC.md](SPEC.md) | Schemas, contracts, CLI/MCP details |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, test, PR notes |
| [RELEASING.md](RELEASING.md) | Branching, semver, npm releases |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [ROADMAP.md](ROADMAP.md) | Status and planned work |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

## Building from source

```
git clone https://github.com/Sintexer/jvm-source-lens.git
cd jvm-source-lens
bun install && bun run setup:cfr && bun run build
node dist/cli.js --version
```

Full contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

---

I built jvmsrc because I kept running into the same wall: agents that are great at writing Java but blind to the actual classpath. If it saves you the same 25-turn grind it saved me, that's exactly why this exists. Found a bug, have an idea, or just want to say it helped? Open an issue or a PR — I read everything.

## License

MIT — see [LICENSE](LICENSE).
