# MCP UX work: things to check / follow up

Running list for the agent-ergonomics checkpoints. Tick or delete items as they are resolved.

## Open

### Added with "pass the module from the start"
- [ ] **Measure it:** run `bun run eval --filter filecontext` (4 prompts) and then the full set. Targets: module passed/correct ≥ 90%, first-call usable ≥ 95%. If agents still omit the module, strengthen the tool descriptions (costs tokens) or make the first-call hint part of the result footer ("searched all modules; pass modulePath=<module of your file> for that module's versions").
- [ ] **Eager tokens 2,401 → 2,478** from the longer instruction and the `modulePath` description (6 tools). Re-check against the ~2,000 target when trimming schema noise.
- [ ] **Relative paths resolve against the project root**, not the agent's cwd; a path relative to another directory will not match and falls back to the Gradle-path rules (then `MODULE_NOT_FOUND` with the module list). Windows case-insensitive path matching is not handled.
- [ ] **Source sets:** a file under `src/test/...` maps to its module but the tools still use the compile classpath unless `includeTest` is set; consider inferring `includeTest` from `/src/test/` in the path.
- [ ] **Version-conflict message** no longer repeats the class name in the summary; check the longer error text still reads well in clients.

### Added after real-world feedback (root module empty)
- [x] **Fixed:** with `modulePath` omitted, `pickResolvedConfiguration` returned `root` whenever it merely had the configuration, so `search_classes` / `search_in_artifact` searched an empty classpath ("0 matches") and the agent fell back to the Gradle cache. Root no longer shadows submodules; omitted `modulePath` = all modules; `modulePath: "*"` / `"all"` is the explicit spelling; empty results name the searched modules, or say that only one module was searched. The eval project's root now applies `java` to keep reproducing the shape.
- [ ] **Re-run the evals** (`bun run eval --filter multimodule,i01,i07,s01`) now that the eval root has an empty `compileClasspath`.
- [ ] **Making `modulePath` required was considered and rejected:** the agent cannot know module names before its first call (it would need `resolve_dependencies` first or fail validation), which lowers first-call success. Revisit only if "omitted = all modules" proves too slow on big builds.
- [ ] **Cost of module-less `search_classes` on large builds:** one class index per module on first use (cached per module afterwards), so a 50-module build indexes 50 modules once. Measure; consider a project-wide index or a module cap.
- [ ] **Hook coverage:** the agent fell back to `unzip` on the Gradle cache. The Checkpoint 5 hook blocks this in Claude Code if installed; confirm it is enabled in the affected setup.

### Added after the first full eval
- [ ] **Re-run the 10 prompts whose first call failed** (`bun run eval --filter d09,i01,i05,i07,i08,i10,m03,m05,s01,s03`) and the full set once more; expected: only genuine-ambiguity prompts (m03, i08-style jackson questions) keep failing strictly. Record in the baseline table.
- [ ] **Checkpoint 7 (tool consolidation): skipped by data.** Selection recall/precision 100%, first-tool accuracy 97%, so there is no sibling confusion to fix. Revisit only if a different model/client shows it.
- [ ] **Planned in ROADMAP.md (P3):** nested-class source (checkpoints N0–N5) and package/docs-only documentation (D0–D5). Notes below are the original observation.
- [ ] **Nested-class source (`Outer$Inner`) fails** with `DECOMPILE_FAILED` when the sources JAR is consulted for `Outer$Inner.java`, which does not exist, and CFR cannot decompile an inner class alone. Fix: look up the outer class's `.java` and extract the nested type's body (`parseJavaTypeMetadata` only handles top-level types today). `get_class_structure` on nested classes works (javap).
- [ ] **Genuine version conflicts still end in an error on the first call** (class-scoped `MODULE_AMBIGUOUS`, retry-ready). Alternative: answer for the first module with a leading conflict note. Kept as an error so the agent cannot silently use the wrong version; reconsider if the "usable" metric stays high but calls/task is too high.
- [ ] **Class-search index cache is now per (module, configuration, includeTest)** (`class-search-index.<hash>.json`); the old single `class-search-index.json` in existing cache buckets is orphaned and never read. Harmless; clean up if cache size matters.
- [ ] **Multi-module `search_classes` index builds** run once per module on first use (then cached); on a big build the first module-less call is the slow one. Measure.
- [ ] **`find_in_class_source` no longer applies the full-source size guard** (it only emits hits). `FIND_SOURCE_TOO_LARGE` in `searchClassSourceText` is still the limit; check that limit is sensible for huge files like `StringUtils` (worked, 389ms).

### Added in Checkpoint 6
- [ ] **Only one eval prompt has been run** (d02, to validate the harness: passed, 1 jvmsrc call, 9s). The full 40-prompt baseline has not been run; it spends tokens on your account. Run `bun run eval`, then `bun run eval --with-hook` and `--mode competing`, and paste the numbers into `docs/mcp-ux-baseline.md`.
- [ ] **Stream-json parsing is validated against one real transcript only** (Claude Code 2.1.286). Event shapes may change between versions; `parseTranscript` skips unknown lines rather than failing.
- [ ] **Deferred tools observed live:** the agent found the tool via `ToolSearch` (`select:mcp__jvmsrc__…`) before calling it. In that mode only names/descriptions matter, so the Checkpoint 4 descriptions are what gets judged. Consider a eval mode where tools are not deferred to compare.
- [ ] **Live-session confirmation of earlier checkpoints:** the agent omitted `projectRoot`, sent `methodNames` as a bare string, and the first call succeeded in 1.4s. Good sign; the hook (Checkpoint 5) is still untested in a live session (`--with-hook` run will do that).
- [ ] **Bash allowlist in the harness** includes `javap`/`unzip`/`jar` deliberately. Other shell commands are denied, which can turn a would-be fallback into a denied call; those still count as fallback only if the command matches the fallback patterns.
- [ ] **Eval project needs Maven Central** on first resolve and uses system `gradle`; no wrapper is committed. Pin Gradle/JDK in the README if results vary by machine.
- [ ] **Precision metric is coarse:** only the 6 negatives can reduce it.
- [x] **Fixed:** annotation-as-method bug (found via the eval project's guava `Lists`). `parseMethodDecl` now strips annotations (with or without arguments) before modifiers/generics and inline annotations from return types; regression tests in `parse-java-type-metadata.test.ts`. Overview now collapses overloads to `name×N`. Related, unchecked: the same stripping is not applied to `javap`-side parsing (not affected) or to field declarations with annotations (they go through `stripAnnotationsPrefix` already).
- [ ] **Redundant error prefix:** `MODULE_AMBIGUOUS` text repeats the subject ("Class X is ambiguous across 2 modules. Class X resolves to different artifacts…"). Trim the summary when the message already names the class.

### Added in Checkpoint 5
- [ ] **Hook API is from memory of the current Claude Code docs** (`PreToolUse` + `hookSpecificOutput.permissionDecision: "deny"` on stdout). The script and rules are unit-tested, but I have not run it inside a live Claude Code session; do that once and confirm the deny reason reaches the agent.
- [ ] **Hook is a heuristic.** Regex-based: a command that merely mentions `javap` in a quoted string is also blocked, and e.g. `python -c` reading a JAR is not. Tune from real blocked/allowed cases.
- [ ] **No Cursor/Codex/others recipes** — only the rules snippet applies there. Add after checking those clients' current hook support.
- [ ] **"Instructions shown?" check is manual.** Record the result per client in the README once you have tried the clients you care about.
- [ ] **README tool table and the multimodule note** still use the old wording in places (e.g. "regex or substring searches"); skim for drift with Checkpoint 4 copy.
- [ ] **Re-homed dropped guidance** (first-call latency, `forceRefresh`) now lives in the README note, not in MCP metadata.

### Added in Checkpoint 4
- [ ] **2,401 eager tokens, target ~2,000.** Schemas are 2,038 of that (instructions 192, descriptions ~500). Remaining cost is structural JSON-schema noise (`$schema`, `additionalProperties: {}`, `maximum: 9007199254740991` on every `.int()`, `minLength`) plus params repeated across tools (`configuration`, `includeTest`, `forceRefresh`, `modulePath`, `projectRoot`). Options: drop `.int()` bounds, drop `configuration`/`includeTest`/`forceRefresh` from tools that rarely need them, or post-process schemas.
- [ ] **Token numbers are `chars/4`.** JSON punctuation tokenizes worse, so real counts are probably higher; verify with a real tokenizer before quoting externally.
- [ ] **Modifier abbreviations kept.** `P/p/prot/pack/s/f/a` stay; legend moved to the result footer (~25 tokens) instead of the instructions. Run the 100-line comparison (omit `public`, mark only non-public) before changing the format.
- [ ] **Explicit "resolved Foo → com.x.Foo" note still not surfaced** (see Checkpoint 2 item); the canonical `className` is in the response only.
- [ ] **`resolve_dependencies` `query` is new surface.** Needed because `include: artifacts` (versions) was only reachable via hidden `full`. Only unit-tested plus a no-external-deps fixture run (`junit` → none); check it against a real version-conflict project via the `version-conflict` scenario (my ad hoc attempt was a broken command, not evidence about that scenario). Output is capped at 60 libraries.
- [ ] **`search_in_artifact` `jarPath`:** compact `resolve_dependencies` no longer shows jar paths (only hidden `include: jarPaths`); agents must use `coordinates`. Decide whether the query listing should show paths.
- [ ] **Dropped guidance to re-home:** `forceRefresh` after SNAPSHOT republish, "first call runs Gradle (5–10s)", subagent paragraph (removed on purpose), `found:false` semantics (now only in result `message`), search_classes AND/glob semantics (now in the `query` param description). Move to README/MCP resources if wanted.
- [ ] **Stale copy elsewhere:** README/server.json/CONTRIBUTING may still describe the removed ladder wording; `server.json` description is separate from `instructions`.

### Added in Checkpoint 3
- [ ] **Eager tokens went up** (4,283 → 5,237) until Checkpoint 4 deletes the duplicated prose. If CP4 does not bring it under ~2,000, reconsider verbose `D.*` descriptions and the `anyOf` for `methodNames`.
- [ ] **Schema noise:** `.int()` adds `maximum: 9007199254740991`, `.min(1)` adds `minLength`, loose objects add `additionalProperties: {}`, and every schema carries `$schema`. About 60 tokens per tool; consider custom JSON-schema post-processing if still over budget.
- [ ] **Descriptions/instructions still document removed params** (`full=true`, `include`, `methodName` singular, `scope=full`, `projectRoot` required). Rewritten in CP4; until then they mislead.
- [ ] **Loose objects mean typos are silently ignored** (e.g. `modulepath`). Acceptable for tolerance; revisit if the call log shows ignored keys. Could log unknown keys in `calls.log`.
- [ ] **Multi-name `get_method_signature`** joins compact texts only; with hidden `full: true` the JSON of each name is dropped (text only). Fine for agents; note for tooling.
- [ ] **Error `content` text is now `summary + message`**: longer than before, intentionally. Check no client truncates; update CLI/other consumers that parse the old summary-only text (none found in repo).
- [ ] **Removing `scope: 'full'`** is a breaking change for any client that sent it (now a validation error). Release note.

### Added in Checkpoint 2
- [ ] **Resolution note not surfaced:** a simple-name / nested-name resolution is visible only as the canonical `className` in the response, not as an explicit "resolved Foo → com.x.Foo" line. Add in Checkpoint 4 when footers move to the result layer (needs a `resolvedFrom` field through 5 result types).
- [ ] **Config-scoped `MODULE_AMBIGUOUS` unchanged:** `search_classes` with no `modulePath` on a multi-module project still errors from `pick-classpath.ts` ("pass modulePath to disambiguate") instead of searching the union or the root. Decide the desired behavior.
- [ ] **Double probe when module is omitted:** `canonicalizeClassName` probes every module for the class, then `inferModulePath` probes again. Cheap (zip central directory + `existsSync`) but could share a result; measure with `calls.log` `durationMs` on a large multi-module build.
- [ ] **Simple-name lookup thrashes the single-slot class-search index** when `modulePath` is omitted (one index per project, rebuilt per module). Only hit on the miss path; consider a per-module index key if it shows up.
- [ ] **Owner choice when versions match:** the first owning module in Gradle order is used (`:app` before `:core`); responses do not mention the other modules that also see the class.
- [ ] **Pre-existing gap fixed on the way:** `inferModulePath` previously ignored source-only inter-project classes (no `build/classes`), so omitting `modulePath` returned `CLASS_NOT_FOUND`. Call out in the release note.
- [ ] **Verified manually** (multi-module fixture, no `projectRoot`, no `modulePath`): `get_class_structure` with `Library` → `com.example.multimodule.Library`. Still unchecked: `get_method_signature` on the same, and a built-vs-unbuilt module comparison.
- [ ] **Visible error text:** `INVALID_FQN` is reused for the simple-name pick list (no new public code). Consider a dedicated code in a future major.

### Carried over

- [ ] **Uncommitted:** Checkpoints 0 and 1 are in the working tree, not committed.
- [ ] **Raw module echo:** `search_classes` empty-result message echoes the raw `module "app"` instead of canonical `:app`. Hit paths and `get_*` tools use the canonical name. Fix in the Checkpoint 2 error-format pass.
- [ ] **CLI parity:** CLI `get`/`resolve` still require a path; they now lift subdirectories to the Gradle root (via shared `resolveProjectRoot`) but do not get workspace-root / env / cwd discovery. Decide whether `--project` should become optional too.
- [ ] **Subdirectory lift is a behavior change:** explicit `projectRoot` pointing at a module dir is now analyzed as the whole project. Confirm this is wanted; add a release note.
- [ ] **Unused `note`:** `resolveProjectRoot` returns a `note` when it lifted the path, but MCP results do not surface it. Surface it in Checkpoint 2 (alongside "resolved Foo → com.x.Foo" notes) or drop the field.
- [ ] **`roots/list` per call:** `listWorkspaceRoots` asks the client on every call that omits an absolute `projectRoot`. Cache it (invalidate on `roots/list_changed`) if the round trip shows up in `calls.log` `durationMs`.
- [ ] **Hint copy still says `projectRoot` is required:** `src/copy/*` and the tool descriptions/instructions mention it as a required argument. Handled by Checkpoints 3–4.
- [ ] **SPEC §7:** document the `MODULE_NOT_FOUND` "matches several modules" variant and the new `JVMSRC_PROJECT_ROOT` env var in the config table.
- [ ] **`readToolVersionFromPackage` in the bundle:** it resolves `../../package.json` relative to `src/diagnostics/`, which is wrong from `dist/mcp.js` (returns `0.0.0`). Pre-existing; affects failure diagnostics' `toolVersion`, which is why `calls.log` does not record it.
- [ ] **Call log:** no `found` flag for compact successes (only `isError`, `code`, `textChars`). Revisit if the eval set needs it.
- [ ] **Token counts are approximate** (`chars / 4`). Swap in a real tokenizer if absolute numbers matter.
- [ ] **Decision pending:** one release per checkpoint vs. batching 1+2 (both touch the public error contract).
- [ ] **Decision pending:** is `full` / JSON `include` consumed outside tests and CLI? Needed before Checkpoint 3 removes them.
