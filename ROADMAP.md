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
- [x] MCP / CLI `search_in_artifact` — grep-like search across all classes in one resolved dependency JAR (sources + CFR fallback); hits grouped by `className` + provenance (**vital gap · priority: P2**)
- [ ] Auto-infer `modulePath` when the FQN resolves in exactly one module (keep explicit `modulePath` for conflicts; discovery via `resolve_dependencies` / `settings.gradle`)
- [x] Compact (plain text) / full (JSON) response modes — default compact; `--full` / MCP `full: true`; `get_class_structure` scopes
- [x] Compact / summary response modes for discovery tools (`get_class_structure`, `resolve_dependencies`, others) — agent-sized JSON without losing "what to call next" (**priority: P2**)

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

## P2 — Agent-driven polish (pending)

### `search_in_artifact` — grep inside one resolved dependency JAR

**Relevance: vital product gap** — Agents often know **which library** the project uses (`resolve_dependencies`, stack trace coordinates, `provenance` from a prior hit) but **not the FQN** that contains a log literal, exception message, or API string. **`search_classes`** only matches indexed metadata (names, Javadoc, identifiers) — not arbitrary text in method bodies. **`find_in_class_source`** requires a known `className`. This tool closes: **resolution-backed grep inside one artifact**.

**Priority: P2** — Implement **after** `find_in_class_source` (reuse `searchClassSourceText` + source fetch).

**References:** [src/class-source-text-search.ts](src/class-source-text-search.ts), [src/find-in-class-source.ts](src/find-in-class-source.ts), [src/class-search/jar-class-fqns.ts](src/class-search/jar-class-fqns.ts), [src/get-class-source.ts](src/get-class-source.ts), SPEC §8.2 (new tool row when implemented)

**Artifact selection (one required):**

| Parameter | Notes |
|-----------|-------|
| `coordinates` | `{ group, name, version? }` — match `ResolvedArtifact` on the chosen configuration |
| `jarPath` | Absolute path to the binary JAR on the resolved classpath |

**Search params:** `projectRoot` (required), `query` (literal default; optional `regex: true`), `contextLines` (default 3), `maxHits` (total across all classes, default 50), `maxClasses` (default 500). Plus standard `modulePath`, `configuration`, `includeTest`, `forceRefresh`.

**Output:** `ok`, `found`, `artifact` (coordinates + `jarPath`), `classesScanned`, `totalMatches`, `hitCount`, `truncated`, `hits[]` grouped by `className` (same hit shape as `find_in_class_source`). Ambiguous coordinates → structured conflict listing candidates, never silent pick.

- [x] MCP tool + CLI; artifact selector + search params as above
- [x] FQN enumeration from resolved `ResolutionOutput` + jar FQN cache
- [x] Per-class source load + `searchClassSourceText`; aggregate hits with provenance
- [x] Ambiguity and not-found errors; caps (`maxHits`, `maxClasses`, byte budget)
- [x] Tests: fixture JAR with known string in one class; decompiled path; ambiguous coordinates

---

### Auto-infer `modulePath`

**Goal:** Reduce friction in multimodule repos when the FQN appears in only one submodule — agents should not have to call `list_modules` first for the common case.

**References:** [src/extractor/pick-classpath.ts](src/extractor/pick-classpath.ts), [src/mcp.ts](src/mcp.ts)

- [ ] When `modulePath` is omitted and the class resolves in exactly one module, use that module
- [ ] When multiple modules match, return a structured conflict (not a silent wrong module) with candidate `modulePath` values
- [ ] Behavior unchanged when `modulePath` is explicitly provided

---

## Security hardening (pending)

**References:** [SPEC.md §6.2](SPEC.md), [src/extractor/zip-entry.ts](src/extractor/zip-entry.ts), [src/cache/index.ts](src/cache/index.ts), [src/resolvers/gradle/gradle-wrapper-command.ts](src/resolvers/gradle/gradle-wrapper-command.ts), [src/class-source-text-search.ts](src/class-source-text-search.ts)

- [ ] **JAR size guard before `fflate` reads** — `statSync` size check (configurable `JVMSRC_MAX_JAR_BYTES`, default 500 MB) before `readFileSync` in `readZipEntryUtf8` / `zipEntryExists`. (`src/extractor/zip-entry.ts:31`)
- [ ] **Skip symlinked directories in build-input cache walk** — `lstatSync` before recursing in `walk()`; skip entries where `isSymbolicLink()` is true. (`src/cache/index.ts:48`)
- [ ] **Document `gradlew` trust model + `JVMSRC_USE_SYSTEM_GRADLE` opt-out** — SECURITY.md / SPEC note; env var forces system `gradle`, giving MCP-host operators a way to opt out of running untrusted wrapper scripts.
- [ ] **ReDoS mitigation for regex in `find_in_class_source`** — current iteration cap counts match advances, not backtracking steps. Options: Worker thread with wall-clock deadline, linear-time engine (`re2`), or documented acceptance. (`src/class-source-text-search.ts:169`)

---

## Cache reliability — future

### Configuration Cache-compatible init script redesign

**Goal:** Enable Gradle's own `--configuration-cache` (CC) to replace the hand-rolled input-side hash entirely. Gradle's CC tracks **all** task inputs — file content, `System.getenv()` calls, system properties, `buildSrc/src/**` source, composite/included builds — making our file-list hash obsolete for that category of changes.

**Why not now:** The current init script registers a single root task (`jvmsrcResolve`) that walks `allprojects {}` at **execution time** inside a `projectsLoaded {}` hook. This pattern is fundamentally incompatible with CC (SPEC §4, also `SPEC.md` note at "Configuration cache"). Enabling CC while using this design causes a Gradle error.

**Required redesign:**
- Replace the root task + `allprojects {}` execution-time walk with per-project tasks declared during project **configuration** (compatible with CC).
- Run with `--configuration-cache` instead of `--no-configuration-cache`.

**Trade-offs vs. current model:**
| | Current (input-side hash) | CC-redesign |
|---|---|---|
| Gradle invoked when unchanged? | No (skipped entirely) | Yes — but CC hit is ~1–2 s |
| Detects `gradle.properties`? | Yes (after this fix) | Yes |
| Detects `System.getenv()` versions? | No — `forceRefresh` needed | Yes |
| Detects `buildSrc/src/**` changes? | No — `forceRefresh` needed | Yes |
| Detects composite build changes? | No — `forceRefresh` needed | Yes |

**References:** [resources/analyzer-init.gradle](resources/analyzer-init.gradle), [src/resolvers/gradle/spawn-gradle.ts](src/resolvers/gradle/spawn-gradle.ts), [src/cache/index.ts](src/cache/index.ts)

---

## P3 — Future / post–v2

### MCP hierarchy discovery (`get_implementors` / `get_subclasses`)

**Goal:** SPEC §12.2 P3 — trace override chains and template/codegen without already knowing the type hierarchy.

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
