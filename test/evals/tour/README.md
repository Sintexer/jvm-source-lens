# Tour demo

One long Claude Code session answers 11 dependency questions in a row. It compares three arms on the same project.
It measures cost, speed, correctness and safety over a whole session, not routing of one prompt (see [../README.md](../README.md) for that).

```bash
bun run tour                                  # 3 arms x 1 rep, all questions
bun run tour --reps 3 --model claude-sonnet-5-5
bun run tour --arms jvmsrc,smart --limit 4
bun run tour --dry-run                        # print the claude commands only
bun run tour --rescore test/evals/results/tour-<stamp>   # re-score saved transcripts, no model calls
```

It spends real tokens. It is not part of CI (only `tour-scoring.test.ts` runs there).

## Arms

| Arm | Dependency access |
|---|---|
| `jvmsrc` | the jvmsrc MCP server |
| `smart` | no MCP; a system-prompt hint says where Gradle caches and sources jars are, and how to read the resolved version |
| `naive` | no MCP, no hint |

All arms get the same tools: Read, Grep, Glob and an open Bash (no `rm`, `mv`, `cp`, `curl`, `git`, …), no web, and the same questions.
Bash must be open. A first run allowed only `Bash(find *)`-style prefixes. Compound commands (`cd x && ls`) were denied, the baselines gave up, and they scored 2/11 for a harness reason, not a tool reason.

## Why the libraries are invented

A model answers questions about Guava or Jackson from memory with zero tool calls. That tests nothing.
So most libraries are **invented** `acme:*` libraries ([synthetic/](synthetic/)), compiled into a local Maven repo by [fixture.ts](fixture.ts). Two real but obscure libraries (uuid-creator, JCTools) are mixed in.
The only way to answer is to read the real classpath.

Each question is a trap that has a checkable answer:

| Kind | Trap |
|---|---|
| `conflict` | declared `acme:ledger:1.0.0`, but `acme:reports` needs `2.0.0`, so Gradle selects `2.0.0`. Both versions are on disk. |
| `nosources` | `acme:geo` (and the flatDir `acme-pricing`) have no sources jar: only decompiling answers |
| `recent` / `obscure` | behavior is in code, not in any documentation |
| `interproject` | the source is in a sibling module, not a jar |
| `bump-before` / `bump-after` | the runner edits `build.gradle` between the two questions (`acme:tax` 1.0.0 → 1.1.0) |

`questions.json` holds regex ground truth (`expect` must all match, `reject` must not).

## No leaks

The agent runs in a temp copy of the project. The local Maven repo is **copied next to it** (`../repo`), so nothing in the repo checkout is reachable by walking up from a path in `build.gradle`. An early run leaked: agents followed the repo path into this directory and read `synthetic/` and `questions.json`. Keep the build file free of hints for the same reason.

## Metrics (per question, averaged over reps)

Tokens include cache reads, because a long session re-reads its context on every turn. Cost is per turn (Claude Code reports `total_cost_usd` for the whole resumed session; the harness takes differences). Also recorded: wall time, tool calls, answer correctness, Gradle runs, shell fallbacks and **files written to the project tree** (hash before and after each turn).

## Known limits

- Regex ground truth can reject a correct answer that words things differently. Check `scores` for a failing arm before you trust a gap.
- jvmsrc runs with a fresh cache per run, so the first call pays the cold resolve.
- Results are for the model and prompt set in `summary.json`. Do not generalize beyond them.
