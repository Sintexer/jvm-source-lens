# MCP UX baseline (Checkpoint 0)

Reference point for the agent-ergonomics work (optional `projectRoot`, tolerant inputs, slimmer copy).
Re-run after each checkpoint and append a row.

## Eager token cost

`bun run measure:tokens` — instructions + tool descriptions + input-schema JSON, as an MCP client sees them.
Approximation: `chars / 4`. Compare deltas, not absolutes.

| Checkpoint | Instructions | Descriptions + schemas (7 tools) | Total |
|---|---|---|---|
| 0 (baseline, v1.16.0) | 783 | 3,500 | **4,283** |

Per tool at baseline (description / schema): `get_class_source` 442/161, `search_classes` 444/142,
`get_method_signature` 416/161, `search_in_artifact` 366/196, `get_class_structure` 323/147,
`find_in_class_source` 251/165, `resolve_dependencies` 203/83.
| 3 (schemas slimmed + `.describe()`) | 783 | 4,454 | **5,237** |
| 4 (copy rewrite + result-layer cleanup) | 192 | 2,209 | **2,401** |

Checkpoint 3 *adds* ~950 tokens: parameter descriptions are now in the schema while the same guidance is still in the prose descriptions and instructions. Checkpoint 4 then removed the prose: net −44% vs baseline.

Targets: total ≤ ~2,000 after Checkpoint 4.

## Call log

Enable with `JVMSRC_CALL_LOG=1` in the MCP server's environment (e.g. the `env` block of the client's MCP config).
Lines land in `calls.log` under the log root (macOS: `~/Library/Logs/jvmsrc/`).

Top error codes:

```bash
jq -r 'select(.isError) | .code // .errorCategory' ~/Library/Logs/jvmsrc/calls.log | sort | uniq -c | sort -rn
```

First-call failure rate:

```bash
jq -s '[.[]|select(.firstCallOfSession)] | {first_calls: length, failed: map(select(.isError))|length}' ~/Library/Logs/jvmsrc/calls.log
```

Known limit: the server cannot see whether the agent then ran `javap`/`unzip` via Bash. That correlation needs the
client transcript (e.g. grep Claude Code session logs for `javap|unzip|.gradle/caches` following a failed jvmsrc call).

## Eval runs

`bun run eval` (see `test/evals/README.md`). Record each full run here.

| Date | Setup | Recall | First-call success | First-tool acc. | Fallback | Notes |
|---|---|---|---|---|---|---|
| 2026-10-01 | smoke: d02 only, Claude Code 2.1.286, default model | 1/1 | 1/1 | 1/1 | 0 | Harness validation, not a baseline |
| 2026-10-01 | **full baseline**, 40 prompts, Claude Code 2.1.286, default model, jvmsrc only + read-only Bash | 100% (34/34 positives; 0/6 negatives used it) | 71% strict / 82% usable | 97% | 0% | Precision 100%, 1.8 calls/task. 12 of 60 calls errored: 9 `MODULE_AMBIGUOUS` (6 config-scoped, 3 real jackson 2.14/2.15 conflict), 2 `SOURCE_OUTPUT_TOO_LARGE` on find, 1 `DECOMPILE_FAILED` on a nested class. Checkpoint 7 not justified (first-tool accuracy 97%). |

"Usable" counts retry-ready answers to genuinely ambiguous questions (same class at different versions per module; a simple name matching several classes). Not yet re-run after the tolerance fixes that followed this baseline; re-run the failing prompts with `bun run eval --filter d09,i01,i05,i07,i08,i10,m03,m05,s01,s03`.
