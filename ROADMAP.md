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
- [ ] MCP server — `get_class_source`
- [ ] MCP server — `resolve_dependencies`
- [ ] MCP server — `list_modules`
- [ ] Inter-project source lookup (`origin: interproject`)

### P1 — MVP polish

- [ ] MCP server — `get_class_structure`
- [ ] CLI `get --json` (single structured object on stdout)
- [ ] CLI progress indicators (long Gradle / decompile waits)
- [ ] Hardening: Gradle timeouts, clearer errors, integration smoke test

### P2 — Post-MVP

- [ ] Class search by simple name / glob + ranked candidates
- [ ] `jvmsrc config` (paste-ready MCP snippet)
- [ ] `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` override for CFR
- [ ] Classpath FQN index (diff-aware patch after resolve)
- [ ] `local-file` artifact origin in extractor
- [ ] Android / Kotlin MPP configuration coverage
- [ ] Resolution schema: optional or remove rarely-used `sourcesJarPath`

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

- [ ] MCP SDK wiring + `startMcpServer()`
- [ ] Tool `get_class_source`: inputs (`className`, `projectRoot`, `modulePath?`, `configuration?`, `includeTest?`, `forceRefresh?`)
- [ ] Response: `source`, `sourceAvailable`, `provenance` or structured error with `code`
- [ ] Build `mcp.js` in prepack; smoke manual test in Cursor/Claude Desktop
- [ ] README §8.2 marked implemented for this tool

---

### MCP server — `resolve_dependencies`

**Goal:** Expose cached/fresh `ResolutionOutput` to agents (README §8.2).

**References:** [src/resolve-with-cache.ts](src/resolve-with-cache.ts)

- [ ] Tool `resolve_dependencies`: `projectRoot`, optional `forceRefresh`
- [ ] Returns validated `ResolutionOutput` JSON
- [ ] Errors as structured tool result (not thrown over MCP)

---

### MCP server — `list_modules`

**Goal:** Agents discover submodule names and scope without parsing full resolution JSON by hand.

**References:** README §8.2, `ResolutionOutput.modules[]`

- [ ] Tool `list_modules`: `projectRoot`, optional `forceRefresh`
- [ ] Response object (not bare array): module name, path, dependency counts per configuration or summary

---

### Inter-project source lookup

**Goal:** README §7 step 1 — classes from `origin: interproject` subprojects, not only external JARs.

**References:** [resources/analyzer-init.gradle](resources/analyzer-init.gradle) (`interproject` artifacts), [src/extractor/extract-external-class-source.ts](src/extractor/extract-external-class-source.ts)

- [ ] New extractor path (or extend pipeline): map FQN → `src/main/java/...` under `interproject.modulePath`
- [ ] Optional `src/test/java` when `--include-test` / test classpath
- [ ] `sourceAvailable: true`, provenance kind `interproject` (extend types if needed)
- [ ] Tests with synthetic `ResolutionOutput`
- [ ] README §7 “current behavior” updated

---

## P1 — MVP polish

### MCP server — `get_class_structure`

**Goal:** Signatures and metadata without full file body (README §8.2, §11 near-term).

**References:** README §8.2 illustrative shape

- [ ] Tool `get_class_structure` with documented input shape
- [ ] v1 implementation: parse `.java` from sources path (reuse lookup pipeline)
- [ ] Fallback: bytecode reader or CFR-based structure when no sources (optional for v1)
- [ ] `sourceAvailable` on response per §7.1

---

### CLI `get --json`

**Goal:** Agent-friendly single blob on stdout (complement `--quiet`).

- [ ] Flag `--json` on `get` subcommand
- [ ] Success: one JSON object on stdout (`source`, `sourceAvailable`, `provenance`)
- [ ] Failure: one JSON object on stdout with `error` + `code` (document vs stderr default)
- [ ] README §8.1.1 updated

---

### CLI progress indicators (long Gradle / decompile waits)

**Goal:** Reduce “is it hung?” confusion on cold cache, first resolve, and slow `get` paths. Indeterminate feedback only (no fake percentages unless we later parse Gradle output).

**References:** [src/cli.ts](src/cli.ts), [src/cli-get-output.ts](src/cli-get-output.ts), [src/resolvers/gradle/spawn-gradle.ts](src/resolvers/gradle/spawn-gradle.ts), README §8.1.1 (stdout/stderr contract)

- [ ] Spinner or phase labels on **stderr** while Gradle runs (`resolve`, resolution cache miss on `get`, `jvmsrcResolveSources`)
- [ ] Optional phase line when CFR decompiles (stderr)
- [ ] Disabled when **`--quiet`** / `-q` on `get`; `resolve` stays JSON-clean on stdout (progress stderr-only)
- [ ] Optional **`--verbose`**: forward or trim Gradle stderr for power users (design TBD)
- [ ] README §8.1.1 updated (progress on stderr; scripts use `--quiet` or stdout-only parsing)

---

### Hardening: Gradle timeouts, clearer errors, integration smoke test

- [ ] Timeout / kill long-running Gradle spawns (`jvmsrcResolve`, `jvmsrcResolveSources`)
- [ ] Actionable messages for common failures (no wrapper, repo auth, unsupported project)
- [ ] CI or scripted smoke: resolve + `get` against a minimal Gradle fixture (skip when no Gradle)
- [ ] Optional: document `jvmsrcResolveSources` latency expectations

---

## P2 — Post-MVP

### Class search by simple name / glob + ranked candidates

**Goal:** README §12 — disambiguation for stack traces and partial names.

- [ ] Index FQNs from classpath JARs (and/or project sources) after resolve
- [ ] Accept simple name, prefix/suffix patterns; return ranked candidate list
- [ ] MCP tool or CLI subcommand (TBD in design)

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
3. Enough **P1** to support agents in production (at minimum: one of `get_class_structure` or `--json`, plus basic hardening).

Track progress via the **summary checklist** at the top of this file.
