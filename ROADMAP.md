# jvmsrc roadmap

Living plan for **JVM Source Lens** (`jvmsrc`). Full behavior and schemas remain in [SPEC.md](SPEC.md).

## For developers

When you **merge** work that completes an item (or a clearly scoped sub-bullet under it):

1. Open this file in the same PR (or a follow-up docs-only PR).
2. Change `- [ ]` → `- [x]` for that line only.
3. Do not check parent boxes unless **all** child bullets under that section are done.
4. If you add a new planned item, add it to the **summary checklist** and under the matching **feature section** with `- [ ]`.

---

## Summary checklist

### P0 — MVP core

- [x] CFR decompilation fallback + `decompiled/` cache
- [x] MCP server — `get_class_source`
- [x] MCP server — `resolve_dependencies`
- [x] MCP server — `get_method_signature`
- [x] MCP server — `get_class_structure` (effective API / inherited methods — §12.2)
- [x] MCP server — `list_modules`
- [x] Inter-project source lookup (`origin: interproject`)

### P1 — MVP polish

- [x] Enrich `get_class_structure`: optional `include` (hierarchy, fields, annotations) — §12.2
- [x] Inspection split: bytecode-only MCP overload tool + declaration-centric default payloads — [SPEC §7.2](SPEC.md)
- [x] CLI `get --json` (single structured object on stdout)
- [x] CLI progress indicators (long Gradle / decompile waits)
- [x] Failure diagnostics: structured logs, `JVMSRC_LOG_DIR`, `jvmsrc diagnostics` CLI — [SPEC §6.3](SPEC.md)
- [x] Hardening: Gradle timeouts, clearer errors, integration smoke test

### P2 — Post-MVP

- [x] MCP `search_classes` / class search index (capability discovery, full-text; §12.2)
- [x] `jvmsrc config` (paste-ready MCP snippet)
- [x] `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` override for CFR
- [x] Classpath FQN index (diff-aware patch after resolve)
- [x] `local-file` artifact origin in extractor
- [x] Android / Kotlin MPP configuration coverage
- [x] Resolution schema: optional or remove rarely-used `sourcesJarPath`

### P2 — Agent-driven polish (feedback backlog)

- [x] MCP / CLI `get_class_source` optional excerpt (`methodNames` / `methodName` and/or `startLine` / `endLine`) — avoid dumping very large compilation units into agent context
- [x] MCP / CLI `find_in_class_source` — pattern match inside one resolved compilation unit; return hit line(s) or block + optional ±N context lines (**relevance: high · priority: P2**)
- [ ] MCP / CLI `search_in_artifact` — grep-like search across all classes in one resolved dependency JAR (sources + CFR fallback); hits grouped by `className` + provenance (**vital gap · priority: P2**)
- [ ] Auto-infer `modulePath` when the FQN resolves in exactly one module (keep explicit `modulePath` for conflicts; discovery via `resolve_dependencies` / `settings.gradle`)
- [x] Compact (plain text) / full (JSON) response modes — default compact; `--full` / MCP `full: true`; `get_class_structure` scopes
- [ ] Compact / summary response modes for discovery tools (`get_class_structure`, `resolve_dependencies`, others) — agent-sized JSON without losing “what to call next” (**priority: P2**)

### Security hardening (post-audit 2026-05)

- [x] Strip JVM-injection env vars from Gradle subprocess (mirrors CFR/javap hardening)
- [x] FQN validation before `javap` in bytecode-only path (flag-injection guard)
- [x] Clamp `limit` at MCP Zod boundary for `search_classes`
- [x] Log warning when `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` override is used
- [ ] JAR size guard before `fflate` reads (OOM via large / malicious JAR)
- [ ] Document `gradlew` trust model + add `JVMSRC_USE_SYSTEM_GRADLE` opt-out
- [ ] ReDoS mitigation for regex mode in `find_in_class_source`
- [ ] Skip symlinks-to-directories in build-input cache walk

### P3 — Future / post–v2

- [ ] MCP hierarchy discovery: `get_implementors` / `get_subclasses` (inverted index over resolved JARs; §12.2)

### Done (baseline — do not uncheck)

- [x] `DependencyResolver` registry + `GradleResolver` + init script `jvmsrcResolve`
- [x] Hash-based resolution cache (`resolveWithResolutionCache`, `JVMSRC_CACHE_ROOT`)
- [x] External JAR class lookup on `compileClasspath` (FQN, `--module`, `--include-test`)
- [x] On-demand sources JAR (`jvmsrcResolveSources`, per winning artifact on `get`)
- [x] CLI: `get`, `resolve`, `--force-refresh`, `--quiet`, stdout/stderr contract (SPEC §8.1.1)
- [x] Library export (`public-api.js`, `getClassSource`)
- [x] Structured error `code`s for resolve/get paths

---

## P0 — MVP core

### CFR decompilation fallback + `decompiled/` cache

**Goal:** Complete SPEC §7 step 3 and §11 item 6 — when on-demand sources are unavailable, decompile the winning `.class` with bundled CFR and cache under the global jvmsrc cache.

**References:** [SPEC.md §6.2](SPEC.md), [SPEC.md §7](SPEC.md), [src/decompiler/index.ts](src/decompiler/index.ts), [resources/cfr.jar](resources/cfr.jar)

- [x] CFR subprocess wrapper (`src/decompiler/`)
- [x] Wire into `extractExternalClassSource` / `getClassSource` after sources miss
- [x] Cache layout: `decompiled/<group>/<artifact>/<version>/<ClassName>.java`
- [x] Set `sourceAvailable: false` for decompiled output (CLI stderr, MCP, library)
- [x] Tests (fixture JAR without sources)
- [x] SPEC / spec-handoff updated

---

### MCP server — `get_class_source`

**Goal:** IDE agents get structured source without stdout/stderr split (SPEC §8.2).

**References:** [src/mcp.ts](src/mcp.ts), [src/get-class-source.ts](src/get-class-source.ts)

- [x] MCP SDK wiring + `startMcpServer()`
- [x] Tool `get_class_source`: inputs (`className`, `projectRoot`, `modulePath?`, `configuration?`, `includeTest?`, `forceRefresh?`)
- [x] Response: `source`, `sourceAvailable`, `provenance` or structured error with `code`
- [x] Build `mcp.js` in prepack; smoke manual test in Cursor/Claude Desktop
- [x] SPEC §8.2 marked implemented for this tool

---

### MCP server — `resolve_dependencies`

**Goal:** Expose cached/fresh `ResolutionOutput` to agents (SPEC §8.2).

**References:** [src/resolve-with-cache.ts](src/resolve-with-cache.ts)

- [x] Tool `resolve_dependencies`: `projectRoot`, optional `forceRefresh`
- [x] Returns validated `ResolutionOutput` JSON
- [x] Errors as structured tool result (not thrown over MCP)

---

### MCP server — `get_method_signature`

**Goal:** IDE-like overload browsing — caller knows **`className`** and **`methodName`** and needs overloads and contracts **as you would read them from source** when **`.java`** is on the classpath (parameters, return types, **`throws`**); **`javap`** supplements bytecode-only artifacts and fills gaps. JVM-descriptor–oriented workflows use companion tool **`get_method_signature_bytecode`** (§7.2).

**Implementation:** After resolving Gradle output (cached), read classpath-order **`.java`** (**inter-project** `src/` then **sources JAR** / on-demand fetch). When **`parseJavaTypeMetadata`** succeeds, return overloads from source (**`sourceAvailable: true`**; MCP payloads omit synthetic **`#SRC:`** **`jvmDescriptor`** / **`flagsLine`** where practical). Otherwise locate the owning classpath element (same ordering as **`get_class_source`**) and run **`javap -private -verbose`** (**`sourceAvailable: false`**).

**References:** [SPEC.md §7.2](SPEC.md), [SPEC.md §8.2](SPEC.md), [SPEC.md §12.2](SPEC.md), [src/get-method-signatures.ts](src/get-method-signatures.ts), [src/class-structure/javap-parse.ts](src/class-structure/javap-parse.ts), [src/class-structure/parse-java-type-metadata.ts](src/class-structure/parse-java-type-metadata.ts)

- [x] Tool `get_method_signature`: `className`, `methodName`, `projectRoot`, optional classpath scoping (`modulePath?`, `configuration?`, `includeTest?`, `forceRefresh?`)
- [x] Response: all overloads — parameters (types + names), return type, generic bounds, checked exceptions; **`sourceAvailable: true`** when parsed from **`.java`**, else **`javap`** metadata with **`sourceAvailable: false`**
- [x] Shared **`parseJavaTypeMetadata`** with **`get_class_structure`** for the source-first path
- [x] Errors: same structured pattern as `get_class_source`
- [x] SPEC §7.2 / §8.2 marked implemented for this tool
- [x] **P1:** Dedicated MCP **`javap`**-only overload tool + declaration-centric default payloads ([SPEC §7.2](SPEC.md))

---

### MCP server — `get_method_signature_bytecode`

**Goal:** Strict **`javap -private -verbose`** overload listing with **no** sources / **`src/`** fallback — for agents that need JVM descriptors and classfile attributes without IDE-shaped projection (SPEC §7.2).

**References:** [src/get-method-signatures-bytecode.ts](src/get-method-signatures-bytecode.ts), [src/method-signature-from-javap.ts](src/method-signature-from-javap.ts)

- [x] Tool `get_method_signature_bytecode`: same arguments as `get_method_signature`
- [x] **`sourceAvailable: false`** always; **`provenance`** only **`classpathJar`** \| **`interprojectBytecode`**
- [x] SPEC §8.2

---

### MCP server — `get_class_structure`

**Goal:** API browsing without full file body — **IDE-like** declarations plus **effective surface including inherited methods** when bytecode or source exists on supers/interfaces ([SPEC §7.2](SPEC.md)).

**References:** [SPEC.md §8.2](SPEC.md), §12.2

- [x] Tool `get_class_structure` with documented input shape (+ inherited API in v1)
- [x] v1 implementation: parse `.java` from sources path (reuse lookup pipeline) and/or bytecode when sources missing
- [x] `sourceAvailable` on response per §7.2
- [x] P1 optional `include`: hierarchy, fields, annotations (see §12.2 / ROADMAP P1)
- [x] **P1:** Align source-derived member payloads with declaration-centric shape where javap-shaped fields leak ([SPEC §7.2](SPEC.md))

---

### MCP server — `list_modules`

**Goal:** Agents discover submodule names and scope without parsing full resolution JSON by hand.

**References:** SPEC §8.2, `ResolutionOutput.modules[]`

- [x] Tool `list_modules`: `projectRoot`, optional `forceRefresh`
- [x] Response object (not bare array): module name, path, dependency counts per configuration or summary

---

### Inter-project source lookup

**Goal:** SPEC §7 step 1 — classes from `origin: interproject` subprojects, not only external JARs.

**References:** [resources/analyzer-init.gradle](resources/analyzer-init.gradle) (`interproject` artifacts), [src/extractor/extract-external-class-source.ts](src/extractor/extract-external-class-source.ts)

- [x] New extractor path (or extend pipeline): map FQN → `src/main/java/...` under `interproject.modulePath`
- [x] Optional `src/test/java` when `--include-test` / test classpath
- [x] `sourceAvailable: true`, provenance kind `interproject` (extend types if needed)
- [x] Tests with synthetic `ResolutionOutput`
- [x] SPEC §7 “current behavior” updated

---

## P1 — MVP polish

### Inspection tooling (IDE-first vs bytecode)

**Goal:** Default MCP tools stay aligned with **SPEC §7.2** (IDE-like browsing). Isolate **`javap`-complete** JVM overload contracts behind an explicit advanced entry point.

**References:** [SPEC.md §7.2](SPEC.md)

- [x] MCP tool **`get_method_signature_bytecode`**: **`javap -private -verbose`** only; **`sourceAvailable: false`**; requires resolvable **`.class`** (fails clearly when exploded **`build/classes/**`** or JAR entry is missing — **no** sibling **`src/`** fallback by design)
- [x] Narrow **`get_method_signature`** / **`get_class_structure`** source-path payloads toward declaration-centric fields (reduce javap-shaped fields on **`sourceAvailable: true`** rows where practical)

---

### Enrich `get_class_structure`

**Goal:** Optional sections (hierarchy, fields, annotations) on one tool; shared `ClassStructure` parse (SPEC §12.2 P1).

- [x] Input: optional `include` (e.g. `hierarchy`, `fields`, `annotations`; exact shape §8.2)
- [x] Hierarchy: recursive superclass + interfaces for substitutability checks
- [x] Fields: visibility, `final`, annotations
- [x] Annotations: class, method, field targets via javap `RuntimeVisibleAnnotations` summaries (parameter-level deferred)

---

### CLI `get --json`

**Goal:** Agent-friendly single blob on stdout (complement `--quiet`).

- [x] Flag `--json` on `get` subcommand
- [x] Success: one JSON object on stdout (`source`, `sourceAvailable`, `className`, `provenance`)
- [x] Failure: one JSON object on stdout with `error` + `code` (document vs stderr default)
- [x] SPEC §8.1.1 updated

---

### CLI progress indicators (long Gradle / decompile waits)

**Goal:** Reduce “is it hung?” confusion on cold cache, first resolve, and slow `get` paths. Indeterminate feedback only (no fake percentages unless we later parse Gradle output).

**References:** [src/cli.ts](src/cli.ts), [src/cli-get-output.ts](src/cli-get-output.ts), [src/resolvers/gradle/spawn-gradle.ts](src/resolvers/gradle/spawn-gradle.ts), SPEC §8.1.1 (stdout/stderr contract)

- [x] Spinner or phase labels on **stderr** while Gradle runs (`resolve`, resolution cache miss on `get`, `jvmsrcResolveSources`)
- [x] Optional phase line when CFR decompiles (stderr)
- [x] Disabled when **`--quiet`** / `-q` on `get`; `resolve` stays JSON-clean on stdout (progress stderr-only)
- [x] Optional **`--verbose` / `-v`**: Gradle stderr inherited on **`resolve`** and on Gradle work during **`get`**
- [x] SPEC §8.1.1 updated (progress on stderr; scripts use `--quiet` or stdout-only parsing)

**Note:** `--verbose` streams Gradle stderr to the terminal; phased **`[jvmsrc]`** lines are omitted for those Gradle runs so output is not duplicated on a single TTY line.

---

### Hardening: Gradle timeouts, clearer errors, integration smoke test

- [x] Timeout / kill long-running Gradle spawns (`jvmsrcResolve`, `jvmsrcResolveSources`)
- [x] Actionable messages for common failures (no wrapper, repo auth, unsupported project)
- [x] CI smoke: **`test/fixtures/gradle-smoke-fixture.test.ts`** — synthetic `ResolutionOutput` against the committed **`test/fixtures/gradle-smoke`** tree (inter-project **`get`** + class-search enrichment); **no Gradle** in default `bun test` (fast, deterministic)
- [x] Optional: document `jvmsrcResolveSources` latency expectations

---

### Failure diagnostics (structured logging)

**Goal:** Operators get subprocess tails and environment context on failures without exposing them to agents; callers keep stable **`code`** values ([SPEC §7](SPEC.md)) while **`severity`** / **`errorCode`** enrich logs ([SPEC §6.3](SPEC.md)).

**References:** [SPEC.md §6.3](SPEC.md), [SPEC.md §8.1.3](SPEC.md), [SPEC.md §8.2](SPEC.md)

- [x] Severity taxonomy + mapping from existing failure paths / stable `code`s
- [x] `DiagnosticRecord` schema + input sanitization (no secrets)
- [x] Log root via platform defaults (state/log dirs) + **`JVMSRC_LOG_DIR`** override (non-empty absolute only; reject relative — mirror **`JVMSRC_CACHE_ROOT`** policy)
- [x] NDJSON append to **`current.log`** + size-based rotation + **`diagnostics/<id>.json`** for configured severities
- [x] Subprocess capture hooks for Gradle (**`jvmsrcResolve`**, **`jvmsrcResolveSources`**) and CFR (stdout/stderr tail truncation)
- [x] CLI **`jvmsrc diagnostics`** (`list`, `show`, filters, **`clear --older-than`**)
- [x] Surface **`diagnosticId`** + **`hint`** on CLI failures (**`get`**, **`resolve`**, **`--json`**) and MCP tool errors where a full diagnostic file is written
- [x] Tests: record shape, rotation; diagnostics / rolling-log write failures must not fail the user-visible operation

---

## P2 — Post-MVP

### MCP `search_classes` / class search index

**Goal:** SPEC §12.2 P2 — discovery when FQN unknown (“what HTTP client classes exist?”). Architecturally distinct: index over resolution, not single-class parse.

**v1 shipped:** MCP tool **`search_classes`** + **`class-search-index.json`** sidecar (per resolution cache bucket): external JAR **`.class`** listing (ZIP central directory only) and inter-project **`src/main/java`** / **`src/test/java`** FQNs on the selected classpath; substring + simple-glob queries; ranked hits (`score`). See SPEC §8.2.

**v2 shipped:** **`searchText`** enrichment from **`.java`** when readable: declared method names (constructors mapped to the simple class name), field/enum-constant names from the same parse path as **`parseJavaTypeMetadata`**, and plain text from **`/** … */`** blocks; inter-project paths on disk; external **`-sources.jar`** ZIP entries per FQN when **`sourcesJarPath`** is already present on the artifact (no **`jvmsrcResolveSources`** during index build). **`indexMeta`:** **`sourceEnrichedEntries`**, **`sourceEnrichmentBytesCap`** (max bytes read per source file).

**v3 shipped:** **`local-file`** JAR classpath edges indexed like external jars; **`indexFormatVersion`** 3. **`jar-fqn-cache.json`** sidecar (same bucket): per absolute **`jarPath`**, reuse FQN lists when **`mtime:size`** matches — class-search rebuilds skip re-reading unchanged JAR ZIP central directories when the resolution fingerprint changes but dependency files are unchanged.

- [x] Full-text index over class names, method names, Javadoc when sources available
- [x] MCP tool `search_classes` (or merged surface with CLI); ranked candidates
- [x] Builds on / relates to classpath FQN index (below)

---

### `jvmsrc config`

**Goal:** SPEC §8.1.2 — paste-ready MCP server block for IDEs.

- [x] Subcommand prints JSON snippet for Claude Desktop / Cursor / Windsurf
- [x] Optional: detect `JAVA_HOME`, Gradle wrapper, project root hints

---

### `JVMSRC_CFR_PATH` override

**Goal:** SPEC §9.3 — corporate environments with approved CFR builds.

- [x] Read env in decompiler layer; fall back to bundled `resources/cfr.jar`
- [x] Honor legacy `JVM_ORACLE_CFR_PATH` when unset

---

### Classpath FQN index (diff-aware)

**Goal:** SPEC §6.1 Path 2 — avoid full cold scan on small dependency bumps.

- [x] Persist index beside resolution cache; patch when `resolution.json` changes

---

### `local-file` artifact origin

- [x] Handle `origin: local-file` in extractor (paths from Gradle output)

---

### Android / Kotlin MPP configuration coverage

- [x] Document skipped configuration names; extend init script where safe

---

### Resolution schema: `sourcesJarPath`

- [x] Decide: keep nullable field vs optional vs remove in schema `1.1`
- [x] Migration note in SPEC if schema version bumps

---

## Agent feedback (2026-05)

Collected from an agent that used **`get_class_source`** against a library JAR outside the scanned repo (`base-algorithm-1.13.3` — log message text not present in project sources).

| Parameter | Score | Notes |
|-----------|-------|--------|
| Ease of use | 9/10 | Minimal required params (`className`, `projectRoot`); MCP instructions led to the right tool on first try |
| Usefulness | 10/10 | Answered a question repo code alone could not; avoided stale training-data guesses |
| Range of tools | 8/10 | Strong coverage (source, structure, signatures, search, resolve); missing hierarchy traversal without known FQN |
| Correctness guarantees | 10/10 | `provenance` (coordinates, `jarPath`) confirms classpath-accurate artifact version |
| Speed | 8/10 | First-call Gradle cost acceptable; cache makes follow-ups fast |

**Mapped to roadmap:**

| Feedback | Roadmap item |
|----------|----------------|
| Find implementations / subclasses without known hierarchy | **P3** — `get_implementors` / `get_subclasses` (below) |
| Large `get_class_source` responses | **P2** — optional excerpt / line range on `get`; **`find_in_class_source`** when the anchor is a string/pattern, not a line number |
| Know the library (coordinates/JAR) but not the class; need a string inside the dependency | **P2** — **`search_in_artifact`** (grep inside one resolved artifact) |
| Friction when `modulePath` unknown upfront | **P2** — auto-infer unique module; keep `list_modules` for discovery |

**Infrastructure fixes (same period, not in ratings):** MCP `outputSchema` with `z.union` crashed the SDK (`_zod`); Node runtime needed `child_process` spawn instead of `Bun.spawn`. Rebuild + MCP restart required after fix.

---

## P2 — Agent-driven polish (feedback backlog)

### `get_class_source` — focused excerpt

**Goal:** When a compilation unit is large, return only the method or line range the agent needs — less context noise, same provenance.

**References:** [src/get-class-source.ts](src/get-class-source.ts), [src/mcp.ts](src/mcp.ts), SPEC §8.2

- [x] Optional `methodNames` / `methodName` and/or `startLine` / `endLine` on MCP `get_class_source` and CLI `get`
- [x] Document interaction with `sourceAvailable: false` (decompiled output may not preserve original line numbers)
- [x] Default unchanged: full file when excerpt params omitted

---

### `find_in_class_source` — pattern match with context (find-in-file)

**Relevance: high (9/10)** — Agents often know the **class** (`search_classes` / stack trace) but need a **needle inside the file** (log message literal, `throw new`, annotation, call site) without loading tens of thousands of lines via `get_class_source`. Same provenance guarantees as `get`; much smaller payloads than full-file `get` or blind repo `grep` (which misses JAR-only types and wrong versions).

**Priority: P2** — Same tier as focused excerpt; **implement after or with** shared “fetch source text once” plumbing from `get_class_source`. **Before P3** hierarchy index (`get_implementors` / `get_subclasses`), which is heavier and less frequent. **Below** excerpt if only one P2 slot: excerpt is simpler; find-in-file subsumes “I know the line” only when `contextLines: 0` and exact line match.

**Not a substitute for:** `search_classes` (classpath-wide FQN discovery) or raw workspace `grep` (no version/provenance).

**Goal:** Given a resolved FQN, scan its `.java` (sources JAR, inter-project `src/`, or decompiled fallback) for a query; return each hit with optional surrounding context.

**Proposed tool:** `find_in_class_source` (CLI subcommand TBD, e.g. `jvmsrc find-in-class`).

**Inputs (draft):**

| Parameter | Required | Notes |
|-----------|----------|--------|
| `className` | yes | FQN of the compilation unit to search |
| `projectRoot` | yes | Same as other tools |
| `query` | yes | Literal substring or regex (document which; default literal) |
| `contextLines` | no | 0–N lines above and below each hit (default e.g. 3; 0 = match line only) |
| `maxHits` | no | Cap matches per call (default e.g. 20) |
| `modulePath`, `configuration`, `includeTest`, `forceRefresh` | no | Same semantics as `get_class_source` |

**Output (draft):** `ok`, `found`, `className`, `sourceAvailable`, `provenance`, `hits[]` where each hit has at least `line` (1-based), `column` (optional), `matchedText` or `matchedBlock`, and `contextBefore` / `contextAfter` (arrays of lines or single snippet). For multiline matches (string literal spanning lines), return a **`block`** (startLine–endLine) plus context outside the block.

**Behavior notes:**

- Reuse classpath resolution + source fetch path from `get_class_source` (no second Gradle pass per hit).
- `sourceAvailable: false` (CFR): line numbers are approximate; document in response or downgrade to “snippet only” without stable `line`.
- Regex mode: bounded cost (timeout / max bytes scanned) to avoid agent-driven catastrophic backtracking on huge files.

**References:** [src/get-class-source.ts](src/get-class-source.ts), [src/mcp.ts](src/mcp.ts), SPEC §8.2

- [x] MCP tool + CLI entry (`jvmsrc find-in-class`); inputs/outputs as above
- [x] Literal match v1; optional `regex: true` (bounded iterations)
- [x] Multiline / block match when match spans lines
- [x] Tests: inter-project fixture (`gradle-smoke`), unit tests for search + decompiled `lineNumbersReliable`

---

### `search_in_artifact` — grep inside one resolved dependency JAR

**Relevance: vital product gap** — Agents often know **which library** the project uses (`resolve_dependencies`, stack trace coordinates, `provenance` from a prior hit) but **not the FQN** that contains a log literal, exception message, or API string. **`search_classes`** only matches indexed metadata (names, Javadoc, identifiers) — not arbitrary text in method bodies. **`find_in_class_source`** requires a known `className`. Workspace **`grep`** and blind **`~/.gradle`** scans miss JAR-only types or the wrong version. This tool closes: **resolution-backed grep inside one artifact**.

**Priority: P2** — Implement **after** `find_in_class_source` (reuse `searchClassSourceText` + source fetch). **Before** full classpath-wide body search (heavier; defer unless needed). **Alongside or after** auto-infer `modulePath` (independent).

**Not a substitute for:** `search_classes` (discovery without artifact scope), `find_in_class_source` (single known FQN), or raw `jar tf` / cache grep (no per-project version guarantee).

**Goal:** Given a resolved dependency on the selected classpath, enumerate classes owned by that artifact, load each compilation unit (sources JAR entry, inter-project `src/` when applicable, or CFR on demand), run the same literal/regex search as `find_in_class_source`, and return hits grouped by class with full provenance.

**Proposed tool:** `search_in_artifact` (CLI e.g. `jvmsrc search-artifact` or `jvmsrc grep-artifact`).

**Artifact selection (one required; disambiguate when multiple classpath edges match):**

| Parameter | Required | Notes |
|-----------|----------|--------|
| `coordinates` | one of | `{ group, name, version? }` — match `ResolvedArtifact` on the chosen configuration |
| `jarPath` | one of | Absolute path to the binary JAR on the resolved classpath (unique when present) |

Optional: `modulePath`, `configuration`, `includeTest`, `forceRefresh` — same as other tools.

**Search (same as `find_in_class_source`):**

| Parameter | Required | Notes |
|-----------|----------|--------|
| `projectRoot` | yes | |
| `query` | yes | Literal substring default; optional `regex: true` |
| `contextLines` | no | Per-hit context (default 3) |
| `maxHits` | no | Cap **total** hits across all classes (default e.g. 50) |
| `maxClasses` | no | Cap classes scanned (default e.g. 500); stop early when `maxHits` reached |

**Output (draft):** `ok`, `found`, `query`, `artifact` (coordinates + `jarPath`), `classesScanned`, `totalMatches`, `hitCount`, `truncated`, `hits[]` where each row includes `className`, `sourceAvailable`, per-class `hits[]` (same shape as `find_in_class_source`), and `provenance` for that class. **No matches:** `found: false`, `querySucceeded: true` (artifact resolved and scanned). **Artifact not on classpath:** structured error (e.g. `ARTIFACT_NOT_FOUND`). **Ambiguous coordinates** (multiple versions/jars on classpath): structured conflict listing candidates — never silent pick.

**Behavior notes:**

- FQN list: reuse **`jar-fqn-cache.json`** / ZIP central directory listing from class-search infrastructure where possible; only external + `local-file` JAR artifacts (not inter-project `src/` trees unless artifact is that submodule’s outputs — TBD in SPEC).
- Source fetch: reuse extractor + on-demand `jvmsrcResolveSources` + CFR path per class; share decompile cache.
- Cost controls: byte budget per artifact, per-class source cap, progress optional on CLI; document expected latency for large JARs (e.g. Guava, AWS SDK).
- Do **not** scan `~/.gradle` without a prior `ResolutionOutput` for this `projectRoot`.

**References:** [src/class-source-text-search.ts](src/class-source-text-search.ts), [src/find-in-class-source.ts](src/find-in-class-source.ts), [src/class-search/jar-class-fqns.ts](src/class-search/jar-class-fqns.ts), [src/get-class-source.ts](src/get-class-source.ts), [src/extractor/extract-external-class-source.ts](src/extractor/extract-external-class-source.ts), SPEC §8.2 (new tool row when implemented)

- [ ] MCP tool + CLI; artifact selector + search params as above
- [ ] FQN enumeration from resolved `ResolutionOutput` + jar FQN cache
- [ ] Per-class source load + `searchClassSourceText`; aggregate hits with provenance
- [ ] Ambiguity and not-found errors; caps (`maxHits`, `maxClasses`, byte budget)
- [ ] Tests: fixture JAR with known string in one class; decompiled path; ambiguous coordinates

**Future (out of scope for this item):** classpath-wide body search across **all** resolved artifacts — same pipeline, higher cost; only if `search_in_artifact` proves insufficient.

---

### Auto-infer `modulePath`

**Goal:** Reduce friction in multimodule repos when the FQN appears in only one submodule — agents should not have to call `list_modules` first for the common case.

**References:** [src/extractor/pick-classpath.ts](src/extractor/pick-classpath.ts), [src/mcp.ts](src/mcp.ts)

- [ ] When `modulePath` is omitted and the class resolves in exactly one module, use that module
- [ ] When multiple modules match, return a structured conflict (not a silent wrong module) with candidate `modulePath` values
- [ ] Behavior unchanged when `modulePath` is explicitly provided

---

### Compact (plain text) / full (JSON) response modes

**Shipped:** Default responses are **plain text** (no JSON on success). **`full: true`** (MCP) or **`--full` / `--json`** (CLI) restores structured JSON. **`--verbose` / `-v`** on CLI remains **Gradle stderr only** — not payload size.

**`get_class_structure` scopes (compact text):**

| Scope | Use |
|-------|-----|
| **`overview`** (default) | Class purpose, declared method **names**, counts — no signature lines |
| **`declared`** | Declaration lines per declared method + fields |
| **`effective`** | Declared + capped inherited API (plain-text footer when truncated) |
| **`full: true`** | Legacy JSON `structuredContent` |

**Other tools (compact text):** `resolve_dependencies`, `search_classes`, `get_method_signature`, `find_in_class_source`, `get_class_source` (source + provenance footer), `list_modules`.

**References:** [SPEC.md §8.1.4](SPEC.md), [SPEC.md §8.2](SPEC.md), [src/text-format/](src/text-format/), [src/response-detail.ts](src/response-detail.ts), [src/mcp-tool-result.ts](src/mcp-tool-result.ts)

- [x] SPEC §8.1.4 + §8.2: compact vs full; scopes; agent ladder in MCP instructions
- [x] `src/text-format/` declaration-line renderers
- [x] `get_class_structure` scopes + `classPurpose`
- [x] MCP: omit `structuredContent` on compact success; `full` on all tools
- [x] CLI: `resolve` text default; `--full` / `--json` for JSON
- [x] Tests + MCP tool descriptions

---

## Security hardening (post-audit 2026-05)

Findings from structured security review (2026-05-19). Items ordered by effort — quick wins first.

### Quick wins (trivial, no behaviour change)

- [x] **Clamp `search_classes` `limit` at MCP boundary** — already present: `z.number().int().positive().max(200)` in `searchClassesInputSchema` (`src/mcp.ts:399`).
- [x] **FQN guard before javap in bytecode path** — already present: both `get-method-signatures-bytecode.ts` and `get-class-structure.ts` gate through `findClasspathOwningClass` → `fqnToZipRelPaths`, which returns `INVALID_FQN` before any javap spawn.
- [x] **Warn when CFR JAR override is active** — emit `[jvmsrc] using CFR JAR override: <path>` to stderr whenever `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` is honoured, so operators see non-bundled JARs at runtime. (`src/decompiler/resolve-cfr-jar.ts`)
### Medium effort

- [x] **Strip JVM-injection env vars from Gradle subprocess** — reuse or extend `buildCfrSpawnEnv()` to strip `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES` before spawning Gradle; currently only CFR/javap apply this hardening. (`src/resolvers/gradle/spawn-gradle.ts:80`)
- [ ] **JAR size guard before `fflate` reads** — add a `statSync` size check (configurable via `JVMSRC_MAX_JAR_BYTES`, default 500 MB) before `readFileSync(jarAbsPath)` in `readZipEntryUtf8` / `zipEntryExists`; rejects unreasonably large or malicious JARs before they are loaded into memory. (`src/extractor/zip-entry.ts:31`)
- [ ] **Skip symlinked directories in build-input cache walk** — call `lstatSync` before recursing in `walk()` and skip entries where `isSymbolicLink()` is true; prevents following symlinks that point outside the project root during cache hash computation. (`src/cache/index.ts:48`)

### Larger / design work

- [ ] **Document `gradlew` trust model + `JVMSRC_USE_SYSTEM_GRADLE` opt-out** — add a SECURITY.md / SPEC note stating that launching `./gradlew` is intentional (wrapper trust = project trust) and expose an env var `JVMSRC_USE_SYSTEM_GRADLE=1` that forces the system `gradle` binary, giving MCP-host operators a way to opt out of running untrusted wrapper scripts. (`src/resolvers/gradle/gradle-wrapper-command.ts`, SPEC.md)
- [ ] **ReDoS mitigation for regex in `find_in_class_source`** — the current iteration cap (`maxHits + 10_000`) counts match advances, not backtracking steps; a catastrophic pattern against an 8 MiB source can still freeze the worker. Options: run regex in a `Worker` thread with a wall-clock deadline, adopt a linear-time engine (`re2`), or document and accept the risk. (`src/class-source-text-search.ts:169`)

---

## P3 — Future / post–v2

### MCP hierarchy discovery (`get_implementors` / `get_subclasses`)

**Goal:** SPEC §12.2 P3 — trace override chains and template/codegen without already knowing the type hierarchy. Agent feedback: round out tools beyond `get_class_structure` when the starting type is unknown.

Requires an inverted index (supertype → known subtypes / implementors) across resolved artifacts; high implementation cost, moderate frequency.

- [ ] Design index layout and invalidation with resolution cache (may share infrastructure with class-search index)
- [ ] Tool `get_implementors`: `interfaceName` (FQN), `projectRoot`, optional scoping consistent with other tools
- [ ] Tool `get_subclasses`: `className` (FQN), same scoping — list direct or transitive subclasses where index coverage allows
- [ ] Structured errors; ranked or grouped results (TBD)

---

## Out of scope (v1)

- Maven resolver (`MavenResolver`)
- Bazel resolver
- Pluggable decompiler backends beyond CFR
- Bulk sources download at `jvmsrcResolve` time (use on-demand `jvmsrcResolveSources` only)

---

## MVP definition (SPEC §11)

The minimum **shippable** product checks off:

1. All items under **Done** above (already shipped).
2. All **P0 — MVP core** summary boxes.
3. Enough **P1 — MVP polish** items for production reliability (see summary checklist: at minimum **basic hardening** — timeouts, clearer errors, smoke test — as prioritized there).

Track progress via the **summary checklist** at the top of this file.
