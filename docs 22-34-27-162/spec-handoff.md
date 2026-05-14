# Spec handoff — what landed recently

Short notes for the next person touching this repo. Full detail stays in [README.md](../README.md).

## Product & naming

- **JVM Source Lens** — human-facing name; npm package and binary **`jvmsrc`**.
- **CLI:** `jvmsrc get <className> …` or shorthand **`jvmsrc <className> …`** (first token not `get` / `mcp` / `config` / **`resolve`** → implicit `get`). Implemented in `src/cli.ts`; **`jvmsrc resolve`** prints `ResolutionOutput` JSON (uses `resolveWithResolutionCache`).
- **Cache dir (spec):** global OS cache via [`env-paths`](https://github.com/sindresorhus/env-paths) app id **`jvmsrc`** (`suffix: ''` — no `-nodejs` suffix). Layout: `projects/<8-hex-prefix>/resolution.json`, `resolution.hash`, `bucket-meta.json`; shared `decompiled/`; reserved `gc.json`. See README **§6.1** / **§6.2**. **`JVMSRC_CACHE_ROOT`** must be **absolute** if set (relative → structured error). Nothing is written under the scanned project for resolution cache.

## Gradle resolution (implemented)

- **Init script:** [`resources/analyzer-init.gradle`](../resources/analyzer-init.gradle) — registers root task **`jvmsrcResolve`** after `projectsLoaded`, walks `allprojects`, prints **one** JSON document (no per-subproject merge in Node).
- **Gradle flags (from Node):** `--init-script <abs>`, `--quiet`, **`--no-configuration-cache`**, **`-PjvmsrcWrapper=true|false`**, task **`jvmsrcResolve`**.
- **Output shape:** **`ResolutionOutput`** — `schemaVersion` (currently `1.0`), `resolvedAt`, `buildSystem`, `projectRoot`, `modules[]` (each with `configurations[]` for compile/runtime/test classpaths), `errors[]`. See README **§5.5.2**.

## TypeScript (implemented)

- **`src/resolvers/resolution-output.ts`** — types + `parseResolutionJson` / `validateResolutionOutput` (+ small tests in `resolution-output.test.ts`).
- **`src/resolvers/gradle/index.ts`** — `GradleResolver`: `detect()`, `resolve()` → **`Promise<ResolutionResult>`** (`ok: true` + `output` or `ok: false` + message/stderr). Uses `getBundledResource('analyzer-init.gradle')`.
- **`src/resolvers/index.ts`** — `detectResolver()`, `UnsupportedProjectError`, exports.
- **`src/bundled-resources.ts`** — package root = `package.json` with **`"name": "jvmsrc"`**.
- **`src/cache/paths.ts`** — `resolveGlobalCacheRoot()`, `getProjectResolutionCacheDir()` (result type), `ensureReservedCacheDirs()`, `writeFileAtomicSameDir()`, project bucket id (8-char prefix of SHA-256 of absolute project root).
- **`src/cache/index.ts`** — `computeBuildInputsDigest`, `listBuildInputRelativePaths`, `readCachedResolution`, `writeCachedResolution` (atomic per-file writes; `writeCachedResolution` returns ok/message).
- **`src/resolve-with-cache.ts`** — `resolveWithResolutionCache(projectRoot, options?)` — uses cache hit unless `forceRefresh`; optional `resolver` for tests.

## README spec additions (documented; not all implemented in code yet)

- **`get_class_structure`** MCP — structured class metadata without full source (README §8.2).
- **`sourceAvailable`** on every source-bearing response (CLI / MCP / library) — README **§7.1**.
- **`forceRefresh`** on MCP `resolve_dependencies` and **`jvmsrc resolve --force-refresh`** (CLI); planned on **`jvmsrc get --force-refresh`** when `get` exists — bypass resolution cache; README **§6.1** and §8.1.
- **`jvmsrc config`** subcommand — paste-ready MCP JSON (planned); **§8.1.1**.
- **`JVMSRC_CFR_PATH`** — override bundled CFR; legacy **`JVM_ORACLE_CFR_PATH`** may still be honored when unset (README **§9.3**).
- **Future:** class lookup by simple name / glob with candidate list — README **§12** table row.
- **Preface** at top of README — friendly overview (what / scope / why not cache-scan).

## Dev / packaging

- **`bun run prepack`** — typecheck, build, `scripts/validate-bundled-resources.ts` (min sizes for `cfr.jar` + `analyzer-init.gradle`).
- **Smoke helper:** [`scripts/gradle-resolve-deps-poc.sh`](../scripts/gradle-resolve-deps-poc.sh) runs Gradle against a project with the bundled init (same task/property names as production).

## Still stubs / out of scope in code

- MCP server, extractor, `get` implementation — README describes behavior; not wired end-to-end yet beyond `GradleResolver`, resolution cache layer, and types.
