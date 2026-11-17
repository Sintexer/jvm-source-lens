# MCP evals

Manual harness that measures whether an agent **chooses** the jvmsrc tools and **succeeds on the first call**.
It drives Claude Code headlessly (`claude -p`, your existing login, no API key). It spends tokens and needs
network + Gradle, so it is **not** part of `bun test` or CI (only `scoring.test.ts` runs there).

```bash
bun run eval                              # all 52 Gradle prompts (test/evals/project)
bun run eval:maven                        # all 6 Maven prompts (test/evals/maven-project)
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

## Prompts (`prompts.json`, 52)

| Category | n | What it checks |
|---|---|---|
| `direct` | 14 | Names a library class/method: should go straight to jvmsrc |
| `indirect` | 10 | Symptoms ("NoSuchMethodError…", "which library defines…"): should still pick jvmsrc |
| `multimodule` | 8 | Class only in one module, or the same artifact at different versions per module |
| `sloppy` | 6 | Simple names, `.class` paths, `Outer.Inner`, module without `:` |
| `filecontext` | 4 | Only a file the user is editing is named (no module): the agent should pass `modulePath` (module or that file) on its first call so it gets *that module's* versions |
| `kotlin` | 4 | kotlinx-coroutines in `:worker`: a `*Kt` facade, a class, a line range, a structure question. Source must come back as `.kt` |
| `negative` | 6 | Questions about this repo's own code or general Java: must **not** call jvmsrc |

Each prompt has `expectJvmsrc` and `expectFirstTools` (any-of sensible first jvmsrc calls).

## Metrics and targets

| Metric | Meaning | Target |
|---|---|---|
| selection recall | positives that called any jvmsrc tool | ≥ 95% (before the hook) |
| selection precision | of prompts that called jvmsrc, how many should have | — (negatives lower it) |
| first-call success | first jvmsrc call returned without `isError` (strict) | reported; the target is **usable** ≥ 95% (below) |
| first-call usable | strict, plus a retry-ready `MODULE_AMBIGUOUS` / ambiguous-simple-name answer | ≥ 95% (checkpoint 3 decision: `ObjectMapper` ambiguity is correct by design) |
| module passed / correct (`filecontext`) | first jvmsrc call carried a concrete `modulePath`, and it denotes the module of the named file | ≥ 90% correct. A low value means the instructions do not make agents pass the module |
| first-tool accuracy | first jvmsrc call ∈ `expectFirstTools` | high; low values mean sibling-tool confusion (Checkpoint 7) |
| calls per task | jvmsrc calls per positive prompt | lower is better |
| shell fallback rate | positives that ran javap/unzip/jar/Gradle-cache commands (attempts the hook blocked do not count) | 0% with `--with-hook` |
| hook denials | fallback attempts the `PreToolUse` hook blocked, whose deny reason came back to the agent as the tool result | > 0 with `--with-hook` proves the reason reaches the agent |
| eager tokens | `bun run measure:tokens` (Anthropic `count_tokens` with `ANTHROPIC_API_KEY`, else `chars / 4`; the method is printed and saved in `summary.json`) | ≤ 2,000 |

A positive prompt **passes** only if jvmsrc was called and no shell fallback ran; a negative passes if jvmsrc was not called.

## Reading results

`results/<timestamp>/` (git-ignored) holds `<id>.jsonl` transcripts, `summary.json`, `mcp-config.json` and `server-logs/`.
Compare runs by diffing `summary.json`; re-run `--rescore` after changing `scoring.ts`.

## Caveats

- One run per prompt is noisy; repeat (`--filter`, several runs) before concluding anything from a few percentage points.
- Claude Code may load MCP tools lazily through `ToolSearch`; then only tool names and descriptions are searched, which is exactly what the shortened descriptions optimise for.
- Results depend on the model and the client; record both next to any number you quote.

## Results

Add one row for each full run. Write the model and the client version in the row.

| Date | Setup | Recall | First-call success | First-tool acc. | Fallback | Notes |
|---|---|---|---|---|---|---|
| 2026-10-01 | Full baseline, 40 prompts, Claude Code 2.1.286, default model, jvmsrc + read-only Bash | 100% (34/34; 0/6 negatives) | 71% strict / 82% usable | 97% | 0% | Precision 100%, 1.8 calls/task. 12 of 60 calls had errors: 9 `MODULE_AMBIGUOUS`, 2 `SOURCE_OUTPUT_TOO_LARGE` on find, 1 `DECOMPILE_FAILED` (nested class). The fixes that followed are not measured yet |
| 2026-11-10 | Checkpoint 3 code, default mode, 44 prompts, Claude Code 2.1.322, default model (not recorded by the harness), jvmsrc + read-only Bash, no hook | 100% (38/38; 6/6 negatives) | 87% strict (33/38) / 97% usable (37/38) | 97% | 0% | Precision 100%, 1.45 calls/task, filecontext module correct 100%, all 44 prompts passed. 5 first-call errors: 4 `MODULE_AMBIGUOUS` on `ObjectMapper` (`i08`, `m03`, `s01`, `s03`; retry-ready, all recovered in the next call), 1 `search_classes` with no `query` (`i07`): the agent called before `ToolSearch` loaded the schema, then recovered. Eager tokens 1,982 (`chars / 4`). Hook not measured in this run; see the probe below |
| 2026-11-10 | Checkpoint 3 code, `--with-hook`, 44 prompts, Claude Code 2.1.322, default model (not recorded), jvmsrc + read-only Bash | 100% (38/38; 6/6 negatives) | 87% strict (33/38) / 97% usable (37/38) | 97% | 0% | All 44 passed. Filecontext module correct 100%. No run made a Bash call, so 0 denials here. The hook was checked with a separate probe (below) |
| 2026-11-10 | Checkpoint 3 code, `--mode competing`, 44 prompts, Claude Code 2.1.322, default model (not recorded), jvmsrc + read-only Bash + WebSearch/WebFetch | 100% (38/38; 6/6 negatives) | 89% strict (34/38) / 100% usable (38/38) | 97% | 0% | All 44 passed. Filecontext module correct 100%. No web tool used. The strict gain is the `i07` empty call, which did not recur |
| 2026-11-17 | Checkpoint 6 code, `--filter kotlin` (4 Kotlin prompts), default mode, Claude Code 2.1.325, default model (not recorded), jvmsrc + read-only Bash | 100% (4/4) | 75% strict / 75% usable (3/4) | 100% | 0% | All 4 passed, 1.3 calls/task, eager tokens 1,993 (`chars / 4`). `get` returned `.kt` text for the `DelayKt` facade, `CoroutineScope` and `Job` from the Multiplatform sources JAR. The one first-call error is `k01`: the agent passed `methodNames: "delay"` on Kotlin source, got the Java-only message and retried with a line range. This is the designed behavior until checkpoint 7 |
| 2026-11-17 | Checkpoint 6 code, `--limit 5` (`d01`–`d05`) regression check, same setup | 100% (5/5) | 100% / 100% | 100% | 0% | All 5 passed, 1.0 calls/task. Not a full run |
| 2026-11-17 | Checkpoint 7 code, `--filter kotlin` (4 Kotlin prompts), default mode, Claude Code 2.1.325, default model (not recorded), jvmsrc + read-only Bash | 100% (4/4) | 100% strict / 100% usable | 100% | 0% | All 4 passed, 1.0 calls/task, eager tokens 1,992 (`chars / 4`). `k01` now succeeds on the first call: `methodNames: "delay"` on `kotlinx.coroutines.DelayKt` returns both `delay` overloads with their KDoc (checkpoint 6 returned the Java-only message and needed a retry). Compare with the checkpoint 6 Kotlin row above |
| 2026-11-17 | Checkpoint 7 code, `--limit 5` (`d01`–`d05`) regression check, same setup | 100% (5/5) | 100% / 100% | 100% | 0% | All 5 passed, 1.0 calls/task. Not a full run |
| 2026-11-17 | Checkpoint 10 code, `bun run eval:maven` (6 Maven prompts `mv01`–`mv06` on `maven-project/`), Claude Code 2.1.325, default model, jvmsrc + read-only Bash | 100% (5/5; 1/1 negative) | 80% strict (4/5) / 100% usable (5/5) | 100% | 0% | All 6 passed, precision 100%, `filecontext` module passed/correct 100% (`mv04`), 1.6 calls/task, eager tokens 1,972 (`chars / 4`). The single strict non-ok (`mv03`) is the designed retry-ready `MODULE_AMBIGUOUS` on `ObjectMapper` (`2.15.2` in `app` vs `2.14.2` in `worker`), recovered immediately. Meets all Checkpoint 3 targets; Maven graduated from experimental |

**Hook probe (2026-11-10, after the `--with-hook` run).** The prompt asked for `javap -version` with the hook installed, in `project/`, with the harness flags. The hook denied the call. The agent got the deny reason as the tool result (`PreToolUse:Bash hook error: Blocked: javap reads whatever version is on disk … Use the jvmsrc MCP tools instead …`) and reported it to the user. Cost $0.06. Scoring counts this as a hook denial (`isHookDenial`).
The eval prompts never make the agent reach for a shell command, so the harness cannot test the hook on its own. The probe is the only check of the hook path.

"Usable" includes answers to questions that are really ambiguous, when the answer is ready for a retry. An example is one class with different versions in different modules.

Eager tokens (`bun run measure:tokens`, `chars / 4`): 4,283 at v1.16.0 → 2,401 after the copy rewrite → 2,478 after `modulePath` guidance → 2,584 at v1.19.0 → **1,982** after checkpoint 3 (schema noise removed; `projectRoot`, `configuration`, `forceRefresh`, `maxClasses` no longer advertised). Numbers from the `count_tokens` API are not comparable with these `chars / 4` numbers; start a new series when you first measure with a key.

**Replay of the 2026-10-01 first calls (checkpoint 3, no model).** Each recorded first jvmsrc call was sent again, with the same arguments, to the current server on `project/`. Of the 10 first-call errors in the 40-prompt run, 6 now succeed (`d09`, `i01`, `i05`, `i07`, `i10`, `m05`). The 4 that stay (`i08`, `m03`, `s01`, `s03`) are `MODULE_AMBIGUOUS` on `ObjectMapper`: those prompts name no module, and the class is 2.15.2 in `:app` and 2.14.2 in `:worker`. That answer is correct by design ([PLAN.md](../../PLAN.md), rejected decisions), so on this prompt set the strict first-call success is about 90% at best and "usable" is the metric that the 95% target applies to.
