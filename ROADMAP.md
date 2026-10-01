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
- [x] Auto-infer `modulePath` when the FQN resolves in exactly one module (keep explicit `modulePath` for conflicts; discovery via `resolve_dependencies` / `settings.gradle`)
- [x] CLASS_NOT_FOUND did-you-mean (`suggestions` by exact simple name) + multimodule miss `suggestedModulePaths`
- [x] `get_class_source` `methodNames` excerpts walk superclasses/interfaces for unmatched names (`inheritedExcerpts`)
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
- [ ] **Nested (inner) class source** — `get_class_source` / `get_class_structure` / `get_method_signature` / `find_in_class_source` for `Outer$Inner` read the enclosing `Outer.java` and return only the nested type (today: `DECOMPILE_FAILED`). See *Nested class source* below.
- [ ] **Package & docs-only JAR documentation** — package-level Javadoc (`package-info.java`, `package-summary.html`) and Javadoc from `-javadoc.jar` artifacts when no sources exist. See *Package documentation* below.

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

**References:** [src/extractor/infer-module-path.ts](src/extractor/infer-module-path.ts), [src/enrich-class-not-found.ts](src/enrich-class-not-found.ts), [src/mcp.ts](src/mcp.ts)

- [x] When `modulePath` is omitted and the class resolves in exactly one module, use that module
- [x] When multiple modules match, return a structured conflict (`MODULE_AMBIGUOUS`) with candidate `modulePath` values
- [x] Behavior unchanged when `modulePath` is explicitly provided
- [x] On miss with omitted `modulePath` in multimodule builds, guided message lists `suggestedModulePaths`

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

## P3 — Planned: nested (inner) class source

**Problem (reproduced 2026-10, eval prompt `s04`):** `get_class_source` for `com.google.common.collect.ImmutableList$Builder` fails with `DECOMPILE_FAILED`. Every source lookup derives the file name from the binary name (`fqnToZipRelPaths` → `…/ImmutableList$Builder.java`), which does not exist; the CFR fallback then decompiles the inner `.class` alone and produces nothing. `get_class_structure` still works through `javap` but loses Javadoc and real parameter names for nested types, and `parseJavaTypeMetadata` only finds **top-level** declarations.

**Where it bites:** `fqn-paths.ts` (`sourceRelPath`) is consumed by `extract-external-class-source.ts`, `read-java-source-from-classpath.ts`, `local-module-sources.ts`, `interproject-paths.ts`; the structure/signature source-first paths use `parseJavaTypeMetadata` / `collectMethodSourceSpans`; `search_in_artifact` enumerates `Outer$Inner` entries as if they were separate files.

**Target behavior**

- `Outer$Inner` (any depth) resolves to the enclosing `Outer.java` in sources JARs, inter-project modules and local modules; result contains **only the nested type** (declaration + body, leading Javadoc/annotations), not the whole outer file, so the size guard applies to the slice.
- Line numbers stay **file-relative** (`startLine`/`endLine`, `find_in_class_source` hits), with a one-line header comment naming the enclosing file and range.
- `methodNames` excerpts, `get_method_signature`, `get_class_structure` (Javadoc, parameter names) work on the nested type; `sourceAvailable` stays `true` when read from sources.
- Provenance gains the enclosing file (`sourceRelativePath` of `Outer.java`) and a `nestedIn` field (SPEC §7.1 / §8 update).
- CFR fallback: decompile the **outer** class (CFR emits inner classes inline), cache once per outer entry under `decompiled/`, then extract the nested type with the same locator; `sourceAvailable: false`.
- `search_in_artifact`: skip `$` classes whose outer source was scanned (no duplicate or failed per-inner loads).
- Anonymous / local classes (`Outer$1`, `Outer$1Local`) have no declaration: return the enclosing member's context or a clear message; low priority.
- Unchanged: `Outer.Inner` → `Outer$Inner` canonicalization (already in `canonicalize-class-name.ts`).

**Design notes**

1. **File candidates, in order:** the exact `Outer$Inner.java` (rare real top-level names containing `$`), then the outer name (strip from the first `$`). New `fqnToSourceCandidates()` instead of one `sourceRelPath`.
2. **Locator:** `locateTypeDeclaration(source, ['Outer','Inner',…])` → `{ start (incl. leading Javadoc/annotations), openBrace, closeBrace }`. Reuse `findTopLevelTypeKeywordMatch`, `findTypeBodyOpenBrace`, `indexOfMatchingBrace`, `skipLexicalNoise`, `extendSpanWithLeadingJavadoc`; descend by scanning member declarations at body depth 0 (the member loop in `parseJavaTypeMetadata` currently *skips* nested types). Must handle strings, char literals `'{'`, comments, text blocks, annotations with braces, generics, `record`/`enum`/`interface`/`@interface` members, same simple name nested under different outers.
3. **Metadata:** `parseJavaTypeMetadata(source, fqn)` takes the nested path so header, members and Javadoc come from the nested body; `collectMethodSourceSpans` restricted to the nested range.
4. **Not solvable from the name:** non-public secondary top-level classes living in another file; stay on the CFR fallback.

**Checkpoints (developer stops after each)**

- [ ] **N0 — Spike:** confirm CFR behavior (inner alone vs outer with `--innerclasses`/default) on guava `ImmutableList`; record findings and decide the decompile fallback shape.
- [ ] **N1 — Locator + tests:** `locateTypeDeclaration` with unit tests for the cases above (no pipeline wiring yet).
- [ ] **N2 — Source lookup:** `fqnToSourceCandidates` through the sources-JAR / inter-project / local-module readers; `get_class_source` returns the nested slice with file-relative line numbers; provenance + SPEC.
- [ ] **N3 — Structure, signatures, find, excerpts:** `parseJavaTypeMetadata` nested path; `get_class_structure` / `get_method_signature` Javadoc and parameter names; `find_in_class_source` on the slice; `methodNames` excerpts.
- [ ] **N4 — Decompile fallback + search_in_artifact:** outer-class decompile with extraction and cache; skip scanned `$` classes.
- [ ] **N5 — Evals:** `s04` passes first call; add 3–4 nested-class prompts to `test/evals/prompts.json`; re-run baseline.

**Acceptance:** `get_class_source com.google.common.collect.ImmutableList$Builder` (and `methodNames: ["build"]`) succeeds from a sources JAR and under the size limit; same call with sources absent succeeds via the outer-class decompile; no regression in `bun test`.

---

## P3 — Planned: package documentation and docs-only artifacts

**Problem:** agents often need to know **what a package is for** ("what does `org.springframework.retry` do?") or want a library's own prose, and some dependencies publish **documentation without sources** (`-javadoc.jar`; older JARs with `package.html`). Today jvmsrc ignores both: the Gradle init script deliberately drops `*-javadoc.jar` artifacts (`analyzer-init.gradle`), there is no on-demand javadoc resolution (only `jvmsrcResolveSources`), and package-level Javadoc (`package-info.java`) is never surfaced. For classes without sources the agent gets decompiled code with no comments (`sourceAvailable: false`).

**Documentation sources, in priority order**

| # | Source | Content | Cost |
|---|---|---|---|
| 1 | `package-info.java` in the sources JAR (or inter-project `src/main/java`) | package Javadoc | low: existing ZIP reader + Javadoc extraction |
| 2 | `-javadoc.jar` → `…/package-summary.html` (+ `package-tree`, `index-all`, `element-list`) | package description, type list with summaries | medium: Gradle `JavadocArtifact` resolution + HTML→text |
| 3 | `-javadoc.jar` → `…/Foo.html` | class and member Javadoc when **no sources** exist | medium: same HTML extractor |
| 4 | `package.html` / `overview.html` in binary or sources JARs | legacy package docs | low |
| 5 | Resource docs (`META-INF`/root `README`, `*.md`) | free-form | later, optional |

**Target behavior**

- A way to ask for a package: description + list of its types with one-line summaries, labelled with the **source of the text** (`sourcesJar` / `javadocJar` / `packageHtml`).
- `get_class_structure` / `get_method_signature`: when sources are absent but a javadoc JAR exists, fill `Purpose:` and member Javadoc from it (`sourceAvailable` stays `false`; add a `docsSource` field so the two are not conflated).
- Optional docs search ("find the concept 'retry'" across prose): either `search_in_artifact` with a docs scope or enrichment of the class-search index with package/class summaries.
- Output budgets and `truncated` flags like the other tools; no network fetch of linked pages; HTML is treated as untrusted (strip scripts/styles, never execute, size guard).

**Design notes**

1. **Resolution:** new on-demand Gradle task `jvmsrcResolveJavadoc` mirroring `jvmsrcResolveSources` (ArtifactResolutionQuery with the javadoc artifact type — *verify the exact Gradle API on the supported Gradle versions in the spike*), plus `resolve-javadoc-jar.ts` mirroring `resolve-sources-jar.ts`. Keep it **on demand** (no `ResolutionOutput` schema bump); private-repository credentials work as for sources.
2. **HTML extraction:** JDK 8 vs 11 vs 17+ javadoc layouts differ (`div.block`, `section.package-description`, `section.class-description`). Prefer a small tolerant extractor targeting those containers with a stripped-text fallback, **without new runtime dependencies** unless the spike shows it is unreliable (then evaluate a minimal HTML parser).
3. **Caching:** extracted text per (JAR path + mtime/hash, entry) under a global `docs/` directory beside `decompiled/` (SPEC §6.2).
4. **Tool surface — decide in D0:** (a) dedicated `get_package_docs` (best discoverability for tool search; ~+200 eager tokens), vs (b) let `get_class_structure` accept a package name (no new tool, overloaded semantics). Add 6 package-doc prompts to the evals and compare selection and first-call success; check `bun run measure:tokens` stays reasonable.
5. **Errors:** new stable code(s) (e.g. `DOCS_NOT_FOUND`, `DOCS_RESOLVE_FAILED`) are a public-contract change: SPEC §7 and a release note.
6. **Out of scope for now:** JDK (`java.*`) docs, Maven site/Dokka non-Javadoc formats, documentation fetched from the web.

**Checkpoints (developer stops after each)**

- [ ] **D0 — Discovery spike:** list which artifacts on a real project (eval project plus the developer's own) are docs-only or have `package-info` / `package.html`; verify the Gradle API for javadoc artifacts; sample HTML from JDK 8, 11 and 17+ javadoc; decide tool surface (4 above). Output: short findings added here.
- [ ] **D1 — `package-info.java` from sources:** package Javadoc end to end (tool or fold-in per D0), including inter-project modules; tests with a synthetic sources JAR.
- [ ] **D2 — Javadoc JAR resolution + extraction:** `jvmsrcResolveJavadoc`, HTML extractor, package summary and type list; synthetic javadoc-JAR fixtures for each layout; docs cache.
- [ ] **D3 — Class and member Javadoc without sources:** `get_class_structure` / `get_method_signature` fallback and `docsSource` field; SPEC §7.1 / §8.
- [ ] **D4 — Docs search (optional):** `search_in_artifact` docs scope or index enrichment, whichever D0 favors.
- [ ] **D5 — Evals and copy:** package-doc prompts, tool description (selection signal), token budget check, README/SPEC.

**Open questions (answer before D0)**

1. What exactly are the "docs only" JARs you meet: `-javadoc.jar` classifiers, internal documentation artifacts (Markdown/HTML), or something else? A concrete example artifact would settle the extractor scope.
2. Should package documentation be a new tool or part of `get_class_structure`?
3. Priority against nested-class support and the open items in `docs/mcp-ux-todo.md`.

**Sequencing:** do *Nested class source* first. Its locator and Javadoc handling are reused for per-member documentation, and it fixes a failure seen in the eval baseline.

---

## MVP definition (SPEC §11)

The minimum **shippable** product checks off:

1. All items under **Done** above (already shipped).
2. All **P0 — MVP core** summary boxes.
3. Enough **P1 — MVP polish** items for production reliability (see summary checklist: at minimum **basic hardening** — timeouts, clearer errors, smoke test — as prioritized there).

Track progress via the **summary checklist** at the top of this file.
