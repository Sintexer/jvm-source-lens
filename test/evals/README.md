# MCP evals

Manual harness that measures whether an agent **chooses** the jvmsrc tools and **succeeds on the first call**.
It drives Claude Code headlessly (`claude -p`, your existing login, no API key). It spends tokens and needs
network + Gradle, so it is **not** part of `bun test` or CI (only `scoring.test.ts` runs there).

```bash
bun run eval                              # all 40 prompts
bun run eval --filter negative            # a category or id; comma-separate several: d01,i05,m03
bun run eval --limit 5                    # first N prompts (cheap smoke run)
bun run eval --mode competing             # also allow WebSearch / WebFetch
bun run eval --with-hook                  # install docs/hooks/block-jvm-fallbacks.mjs
bun run eval --model <model-id>           # default: your Claude Code default
bun run eval --concurrency 3 --budget 0.5 # parallel runs; USD cap per prompt
bun run eval --dry-run                    # print the claude commands only
bun run eval --rescore test/evals/results/<run>   # re-score saved transcripts, no model calls
```

## What runs

- Project: [`project/`](project/README.md), a 3-module Gradle build (jackson-databind **2.15.2** in `:app` vs **2.14.2** in `:worker`, guava only in `:worker`, spring-retry only in `:app`, a local `UserService`).
- MCP server: this checkout (`bun src/cli.ts mcp`) with `JVMSRC_CALL_LOG=1`, so each run also leaves `server-logs/calls.log` (error codes, first-call flags).
- Isolation: `--strict-mcp-config` and `--setting-sources project`, so your user-level `CLAUDE.md`, hooks and MCP servers do not leak in.
- Tools allowed: jvmsrc, Read/Grep/Glob, and read-only Bash (including `javap`, `unzip`, `jar`) **on purpose**: the point is to see whether the agent prefers jvmsrc, not to force it. Anything else is denied (`dontAsk`).

## Prompts (`prompts.json`, 40)

| Category | n | What it checks |
|---|---|---|
| `direct` | 10 | Names a library class/method: should go straight to jvmsrc |
| `indirect` | 10 | Symptoms ("NoSuchMethodError…", "which library defines…"): should still pick jvmsrc |
| `multimodule` | 8 | Class only in one module, or the same artifact at different versions per module |
| `sloppy` | 6 | Simple names, `.class` paths, `Outer.Inner`, module without `:` |
| `negative` | 6 | Questions about this repo's own code or general Java: must **not** call jvmsrc |

Each prompt has `expectJvmsrc` and `expectFirstTools` (any-of sensible first jvmsrc calls).

## Metrics and targets

| Metric | Meaning | Target |
|---|---|---|
| selection recall | positives that called any jvmsrc tool | ≥ 95% (before the hook) |
| selection precision | of prompts that called jvmsrc, how many should have | — (negatives lower it) |
| first-call success | first jvmsrc call returned without `isError` | ≥ 95% |
| first-tool accuracy | first jvmsrc call ∈ `expectFirstTools` | high; low values mean sibling-tool confusion (Checkpoint 7) |
| calls per task | jvmsrc calls per positive prompt | lower is better |
| shell fallback rate | positives that ran javap/unzip/jar/Gradle-cache commands | 0% with `--with-hook` |
| eager tokens | `bun run measure:tokens` | ≤ ~2,000 |

A positive prompt **passes** only if jvmsrc was called and no shell fallback ran; a negative passes if jvmsrc was not called.

## Reading results

`results/<timestamp>/` (git-ignored) holds `<id>.jsonl` transcripts, `summary.json`, `mcp-config.json` and `server-logs/`.
Compare runs by diffing `summary.json`; re-run `--rescore` after changing `scoring.ts`.

## Caveats

- One run per prompt is noisy; repeat (`--filter`, several runs) before concluding anything from a few percentage points.
- Claude Code may load MCP tools lazily through `ToolSearch`; then only tool names and descriptions are searched, which is exactly what the shortened descriptions optimise for.
- Results depend on the model and the client; record both next to any number you quote.
