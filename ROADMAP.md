# jvmsrc roadmap

Living plan for **JVM Source Lens** (`jvmsrc`). Full behavior and schemas remain in [README.md](README.md).

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
- [x] Inspection split: bytecode-only MCP overload tool + declaration-centric default payloads — [README §7.2](README.md)
- [x] CLI `get --json` (single structured object on stdout)
- [x] CLI progress indicators (long Gradle / decompile waits)
- [x] Failure diagnostics: structured logs, `JVMSRC_LOG_DIR`, `jvmsrc diagnostics` CLI — [README §6.3](README.md)
- [x] Hardening: Gradle timeouts, clearer errors, integration smoke test

### P2 — Post-MVP

- [x] MCP `search_classes` / class search index (capability discovery, full-text; §12.2)
- [ ] `jvmsrc config` (paste-ready MCP snippet)
- [ ] `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` override for CFR
- [ ] Classpath FQN index (diff-aware patch after resolve)
- [ ] `local-file` artifact origin in extractor
- [ ] Android / Kotlin MPP configuration coverage
- [ ] Resolution schema: optional or remove rarely-used `sourcesJarPath`

### P3 — Future / post–v2

- [ ] MCP `get_implementors(interfaceName)` (inverted index over resolved JARs; §12.2)

### Done (baseline — do not uncheck)

- [x] `DependencyResolver` registry + `GradleResolver` + init script `jvmsrcResolve`
- [x] Hash-based resolution cache (`resolveWithResolutionCache`, `JVMSRC_CACHE_ROOT`)
- [x] External JAR class lookup on `compileClasspath` (FQN, `--module`, `--include-test`)
- [x] On-demand sources JAR (`jvmsrcResolveSources`, per winning artifact on `get`)
- [x] CLI: `get`, `resolve`, `--force-refresh`, `--quiet`, stdout/stderr contract (README §8.1.1)
- [x] Library export (`public-api.js`, `getClassSource`)
- [x] Structured error `code`s for resolve/get paths

---

## P0 — MVP core

### CFR decompilation fallback + `decompiled/` cache

**Goal:** Complete README §7 step 3 and §11 item 6 — when on-demand sources are unavailable, decompile the winning `.class` with bundled CFR and cache under the global jvmsrc cache.

**References:** [README.md §6.2](README.md), [README.md §7](README.md), [src/decompiler/index.ts](src/decompiler/index.ts), [resources/cfr.jar](resources/cfr.jar)

- [x] CFR subprocess wrapper (`src/decompiler/`)
- [x] Wire into `extractExternalClassSource` / `getClassSource` after sources miss
- [x] Cache layout: `decompiled/<group>/<artifact>/<version>/<ClassName>.java`
- [x] Set `sourceAvailable: false` for decompiled output (CLI stderr, MCP, library)
- [x] Tests (fixture JAR without sources)
- [x] README / spec-handoff updated

---

### MCP server — `get_class_source`

**Goal:** IDE agents get structured source without stdout/stderr split (README §8.2).

**References:** [src/mcp.ts](src/mcp.ts), [src/get-class-source.ts](src/get-class-source.ts)

- [x] MCP SDK wiring + `startMcpServer()`
- [x] Tool `get_class_source`: inputs (`className`, `projectRoot`, `modulePath?`, `configuration?`, `includeTest?`, `forceRefresh?`)
- [x] Response: `source`, `sourceAvailable`, `provenance` or structured error with `code`
- [x] Build `mcp.js` in prepack; smoke manual test in Cursor/Claude Desktop
- [x] README §8.2 marked implemented for this tool

---

### MCP server — `resolve_dependencies`

**Goal:** Expose cached/fresh `ResolutionOutput` to agents (README §8.2).

**References:** [src/resolve-with-cache.ts](src/resolve-with-cache.ts)

- [x] Tool `resolve_dependencies`: `projectRoot`, optional `forceRefresh`
- [x] Returns validated `ResolutionOutput` JSON
- [x] Errors as structured tool result (not thrown over MCP)

---

### MCP server — `get_method_signature`

**Goal:** IDE-like overload browsing — caller knows **`className`** and **`methodName`** and needs overloads and contracts **as you would read them from source** when **`.java`** is on the classpath (parameters, return types, **`throws`**); **`javap`** supplements bytecode-only artifacts and fills gaps. JVM-descriptor–oriented workflows use companion tool **`get_method_signature_bytecode`** (§7.2).

**Implementation:** After resolving Gradle output (cached), read classpath-order **`.java`** (**inter-project** `src/` then **sources JAR** / on-demand fetch). When **`parseJavaTypeMetadata`** succeeds, return overloads from source (**`sourceAvailable: true`**; MCP payloads omit synthetic **`#SRC:`** **`jvmDescriptor`** / **`flagsLine`** where practical). Otherwise locate the owning classpath element (same ordering as **`get_class_source`**) and run **`javap -private -verbose`** (**`sourceAvailable: false`**).

**References:** [README.md §7.2](README.md), [README.md §8.2](README.md), [README.md §12.2](README.md), [src/get-method-signatures.ts](src/get-method-signatures.ts), [src/class-structure/javap-parse.ts](src/class-structure/javap-parse.ts), [src/class-structure/parse-java-type-metadata.ts](src/class-structure/parse-java-type-metadata.ts)

- [x] Tool `get_method_signature`: `className`, `methodName`, `projectRoot`, optional classpath scoping (`modulePath?`, `configuration?`, `includeTest?`, `forceRefresh?`)
- [x] Response: all overloads — parameters (types + names), return type, generic bounds, checked exceptions; **`sourceAvailable: true`** when parsed from **`.java`**, else **`javap`** metadata with **`sourceAvailable: false`**
- [x] Shared **`parseJavaTypeMetadata`** with **`get_class_structure`** for the source-first path
- [x] Errors: same structured pattern as `get_class_source`
- [x] README §7.2 / §8.2 marked implemented for this tool
- [x] **P1:** Dedicated MCP **`javap`**-only overload tool + declaration-centric default payloads ([README §7.2](README.md))

---

### MCP server — `get_method_signature_bytecode`

**Goal:** Strict **`javap -private -verbose`** overload listing with **no** sources / **`src/`** fallback — for agents that need JVM descriptors and classfile attributes without IDE-shaped projection (README §7.2).

**References:** [src/get-method-signatures-bytecode.ts](src/get-method-signatures-bytecode.ts), [src/method-signature-from-javap.ts](src/method-signature-from-javap.ts)

- [x] Tool `get_method_signature_bytecode`: same arguments as `get_method_signature`
- [x] **`sourceAvailable: false`** always; **`provenance`** only **`classpathJar`** \| **`interprojectBytecode`**
- [x] README §8.2

---

### MCP server — `get_class_structure`

**Goal:** API browsing without full file body — **IDE-like** declarations plus **effective surface including inherited methods** when bytecode or source exists on supers/interfaces ([README §7.2](README.md)).

**References:** [README.md §8.2](README.md), §12.2

- [x] Tool `get_class_structure` with documented input shape (+ inherited API in v1)
- [x] v1 implementation: parse `.java` from sources path (reuse lookup pipeline) and/or bytecode when sources missing
- [x] `sourceAvailable` on response per §7.2
- [x] P1 optional `include`: hierarchy, fields, annotations (see §12.2 / ROADMAP P1)
- [x] **P1:** Align source-derived member payloads with declaration-centric shape where javap-shaped fields leak ([README §7.2](README.md))

---

### MCP server — `list_modules`

**Goal:** Agents discover submodule names and scope without parsing full resolution JSON by hand.

**References:** README §8.2, `ResolutionOutput.modules[]`

- [x] Tool `list_modules`: `projectRoot`, optional `forceRefresh`
- [x] Response object (not bare array): module name, path, dependency counts per configuration or summary

---

### Inter-project source lookup

**Goal:** README §7 step 1 — classes from `origin: interproject` subprojects, not only external JARs.

**References:** [resources/analyzer-init.gradle](resources/analyzer-init.gradle) (`interproject` artifacts), [src/extractor/extract-external-class-source.ts](src/extractor/extract-external-class-source.ts)

- [x] New extractor path (or extend pipeline): map FQN → `src/main/java/...` under `interproject.modulePath`
- [x] Optional `src/test/java` when `--include-test` / test classpath
- [x] `sourceAvailable: true`, provenance kind `interproject` (extend types if needed)
- [x] Tests with synthetic `ResolutionOutput`
- [x] README §7 “current behavior” updated

---

## P1 — MVP polish

### Inspection tooling (IDE-first vs bytecode)

**Goal:** Default MCP tools stay aligned with **README §7.2** (IDE-like browsing). Isolate **`javap`-complete** JVM overload contracts behind an explicit advanced entry point.

**References:** [README.md §7.2](README.md)

- [x] MCP tool **`get_method_signature_bytecode`**: **`javap -private -verbose`** only; **`sourceAvailable: false`**; requires resolvable **`.class`** (fails clearly when exploded **`build/classes/**`** or JAR entry is missing — **no** sibling **`src/`** fallback by design)
- [x] Narrow **`get_method_signature`** / **`get_class_structure`** source-path payloads toward declaration-centric fields (reduce javap-shaped fields on **`sourceAvailable: true`** rows where practical)

---

### Enrich `get_class_structure`

**Goal:** Optional sections (hierarchy, fields, annotations) on one tool; shared `ClassStructure` parse (README §12.2 P1).

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
- [x] README §8.1.1 updated

---

### CLI progress indicators (long Gradle / decompile waits)

**Goal:** Reduce “is it hung?” confusion on cold cache, first resolve, and slow `get` paths. Indeterminate feedback only (no fake percentages unless we later parse Gradle output).

**References:** [src/cli.ts](src/cli.ts), [src/cli-get-output.ts](src/cli-get-output.ts), [src/resolvers/gradle/spawn-gradle.ts](src/resolvers/gradle/spawn-gradle.ts), README §8.1.1 (stdout/stderr contract)

- [x] Spinner or phase labels on **stderr** while Gradle runs (`resolve`, resolution cache miss on `get`, `jvmsrcResolveSources`)
- [x] Optional phase line when CFR decompiles (stderr)
- [x] Disabled when **`--quiet`** / `-q` on `get`; `resolve` stays JSON-clean on stdout (progress stderr-only)
- [x] Optional **`--verbose` / `-v`**: Gradle stderr inherited on **`resolve`** and on Gradle work during **`get`**
- [x] README §8.1.1 updated (progress on stderr; scripts use `--quiet` or stdout-only parsing)

**Note:** `--verbose` streams Gradle stderr to the terminal; phased **`[jvmsrc]`** lines are omitted for those Gradle runs so output is not duplicated on a single TTY line.

---

### Hardening: Gradle timeouts, clearer errors, integration smoke test

- [x] Timeout / kill long-running Gradle spawns (`jvmsrcResolve`, `jvmsrcResolveSources`)
- [x] Actionable messages for common failures (no wrapper, repo auth, unsupported project)
- [x] CI smoke: **`test/fixtures/gradle-smoke-fixture.test.ts`** — synthetic `ResolutionOutput` against the committed **`test/fixtures/gradle-smoke`** tree (inter-project **`get`** + class-search enrichment); **no Gradle** in default `bun test` (fast, deterministic)
- [x] Optional: document `jvmsrcResolveSources` latency expectations

---

### Failure diagnostics (structured logging)

**Goal:** Operators get subprocess tails and environment context on failures without exposing them to agents; callers keep stable **`code`** values ([README §7](README.md)) while **`severity`** / **`errorCode`** enrich logs ([README §6.3](README.md)).

**References:** [README.md §6.3](README.md), [README.md §8.1.3](README.md), [README.md §8.2](README.md)

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

**Goal:** README §12.2 P2 — discovery when FQN unknown (“what HTTP client classes exist?”). Architecturally distinct: index over resolution, not single-class parse.

**v1 shipped:** MCP tool **`search_classes`** + **`class-search-index.json`** sidecar (per resolution cache bucket): external JAR **`.class`** listing (ZIP central directory only) and inter-project **`src/main/java`** / **`src/test/java`** FQNs on the selected classpath; substring + simple-glob queries; ranked hits (`score`). See README §8.2.

**v2 shipped:** **`searchText`** enrichment from **`.java`** when readable: declared method names (constructors mapped to the simple class name), field/enum-constant names from the same parse path as **`parseJavaTypeMetadata`**, and plain text from **`/** … */`** blocks; inter-project paths on disk; external **`-sources.jar`** ZIP entries per FQN when **`sourcesJarPath`** is already present on the artifact (no **`jvmsrcResolveSources`** during index build). **`indexMeta`:** **`sourceEnrichedEntries`**, **`sourceEnrichmentBytesCap`** (max bytes read per source file).

- [x] Full-text index over class names, method names, Javadoc when sources available
- [x] MCP tool `search_classes` (or merged surface with CLI); ranked candidates
- [ ] Builds on / relates to classpath FQN index (below)

---

### `jvmsrc config`

**Goal:** README §8.1.2 — paste-ready MCP server block for IDEs.

- [ ] Subcommand prints JSON snippet for Claude Desktop / Cursor / Windsurf
- [ ] Optional: detect `JAVA_HOME`, Gradle wrapper, project root hints

---

### `JVMSRC_CFR_PATH` override

**Goal:** README §9.3 — corporate environments with approved CFR builds.

- [ ] Read env in decompiler layer; fall back to bundled `resources/cfr.jar`
- [ ] Honor legacy `JVM_ORACLE_CFR_PATH` when unset

---

### Classpath FQN index (diff-aware)

**Goal:** README §6.1 Path 2 — avoid full cold scan on small dependency bumps.

- [ ] Persist index beside resolution cache; patch when `resolution.json` changes

---

### `local-file` artifact origin

- [ ] Handle `origin: local-file` in extractor (paths from Gradle output)

---

### Android / Kotlin MPP configuration coverage

- [ ] Document skipped configuration names; extend init script where safe

---

### Resolution schema: `sourcesJarPath`

- [ ] Decide: keep nullable field vs optional vs remove in schema `1.1`
- [ ] Migration note in README if schema version bumps

---

## P3 — Future / post–v2

### MCP `get_implementors`

**Goal:** README §12.2 P3 — list known implementations of an interface for template/codegen. Requires inverted index (interface → implementors) across resolved artifacts; high implementation cost, low frequency.

- [ ] Design index layout and invalidation with resolution cache
- [ ] Tool `get_implementors`: `interfaceName` (FQN), `projectRoot`, optional scoping consistent with other tools
- [ ] Structured errors; ranked or grouped results (TBD)

---

## Out of scope (v1)

- Maven resolver (`MavenResolver`)
- Bazel resolver
- Pluggable decompiler backends beyond CFR
- Bulk sources download at `jvmsrcResolve` time (use on-demand `jvmsrcResolveSources` only)

---

## MVP definition (README §11)

The minimum **shippable** product checks off:

1. All items under **Done** above (already shipped).
2. All **P0 — MVP core** summary boxes.
3. Enough **P1 — MVP polish** items for production reliability (see summary checklist: at minimum **basic hardening** — timeouts, clearer errors, smoke test — as prioritized there).

Track progress via the **summary checklist** at the top of this file.
