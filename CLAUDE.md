# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**JVM Source Lens** (`jvmsrc`) — a CLI + MCP server that resolves a JVM project's actual classpath by invoking the build tool (Gradle first), then extracts Java source for a fully-qualified class (sources JAR preferred, CFR decompilation fallback planned).

User-facing overview: [README.md](README.md). Authoritative spec: [SPEC.md](SPEC.md). Implementation status: [ROADMAP.md](ROADMAP.md). Update **SPEC** when behavior or schemas change; update **README** for install/usage; check off **ROADMAP** when shipping features.

## Toolchain

**Runtime:** Node ≥20 for published CLI (esbuild `--target=node20`); CI smoke-tests 20 and 24. **Bun** for this repo (see [CONTRIBUTING.md](CONTRIBUTING.md)).

- `bun run build` — esbuild → `dist/` (`--target=node20`)
- `bun test` / `bun run dev:cli` / `dev:mcp`
- `bun run prepack` — typecheck + build + validate bundled resources

The published `bin` (`jvmsrc`) and `main` both point at `dist/`, so a build is required before `npm pack` / install testing.

Bun-specific preferences for new code: use `Bun.spawn` / `Bun.file` over `node:child_process` / `node:fs` where convenient; `bun:test` (`import { test, expect } from "bun:test"`); no `dotenv` (Bun loads `.env` automatically).

## Test layout

Three tiers, all run with `bun test`:

| Location | Kind | Gradle needed? |
|---|---|---|
| `src/**/*.test.ts` | Unit tests, co-located with source | No |
| `test/fixtures/` | Fast regression with **synthetic** `ResolutionOutput` | No (wrapper JAR optional for local Gradle debugging) |
| `test/scenarios/` | Real-Gradle scenario tests | Yes — wrapper JARs required (gitignored) |

### Gradle smoke fixture

Fast tests in **`test/fixtures/gradle-smoke-fixture.test.ts`** exercise **inter-project `get` / class-search** paths using **synthetic `ResolutionOutput`** that points at the committed **`test/fixtures/gradle-smoke`** tree — **no `gradlew`** in CI (`bun test` stays under a few seconds for that file).

The wrapper JAR under the fixture is **not** committed. To run real Gradle against the fixture locally (e.g. debugging the init script):

- **Generate the JAR:** `bun run ensure:gradle-smoke-wrapper` or `bash scripts/ensure-gradle-smoke-wrapper.sh` (requires **`gradle`** on `PATH` the first time).

### Scenario tests (`test/scenarios/`)

Real-Gradle integration tests organized as `test/scenarios/{build-tool}/{scenario-name}/`. Each scenario contains one or more Gradle projects plus a co-located `scenario.test.ts`.

Current scenarios:

- **`gradle/multi-module/`** — real Gradle resolution of inter-project source (`origin: interproject`) and cache hit behaviour.
- **`gradle/local-maven-publish/`** — `producer/` publishes a snapshot to a temp local Maven repo; `consumer/` depends on it. Tests verify the tool automatically picks up a new method added between two publishes (via local-artifact digest — no `forceRefresh` needed).
- **`gradle/dependency-change/`** — `lib/` publishes two stable versions to a temp local Maven repo; `app/` starts on v1. Tests verify that editing `build.gradle` to reference v2 triggers an automatic cache miss and re-resolution without `forceRefresh`.
- **`gradle/version-conflict/`** — direct dep (v2) and transitive dep (v1) of the same library in `app/`. Tests verify the tool reports exactly the version Gradle selected (`highest-wins`) and that extracted source matches that version.

Wrapper JARs are generated once via `bun run ensure:scenario-wrappers` (calls `scripts/ensure-scenario-wrappers.sh`). All scenario tests use `describe.skipIf(!wrapperJar)` — silent no-op in CI.

`test/scenarios/maven/` and `test/scenarios/bazel/` are stubs (`.gitkeep`) for future build systems.

## Architecture (big picture)

Read SPEC.md §4–§7 before non-trivial changes. The shape that matters:

1. **Resolver registry** (`src/resolvers/index.ts`) detects the build system and delegates. Adding Maven/Bazel = new folder + one line in the registry. Don't bypass this — there is **no fallback to scanning `~/.gradle`**; if resolution fails, surface the error.
2. **Gradle resolver** (`src/resolvers/gradle/`) spawns `./gradlew` (or `gradle`) with `--init-script resources/analyzer-init.gradle --no-configuration-cache jvmsrcResolve`. The init script walks `allprojects` and prints **one** `ResolutionOutput` JSON document per invocation, with each known configuration that exists on a module (JVM compile/test/runtime classpaths plus Kotlin MPP **`jvm*`** classpaths when present). Configuration cache is incompatible with the current root-task design.
3. **Resolution cache** (`src/cache/`, `src/resolve-with-cache.ts`) keys on a SHA-256 digest of declared build inputs (`build.gradle*`, `settings.gradle*`, `gradle/libs.versions.toml`, lockfiles). Per-project bucket lives under `env-paths('jvmsrc', { suffix: '' })` — never under the scanned project tree. `JVMSRC_CACHE_ROOT` overrides the root (must be absolute). Bucket files are written via temp + `rename` for torn-read safety. `forceRefresh` is the only way to bypass the hash cache.
4. **Extractor** (`src/extractor/`) takes a `ResolutionOutput`, picks one `ResolvedConfiguration` via `pick-classpath.ts`, walks artifacts in order, finds the first `jarPath` containing the `.class`, then on demand asks Gradle for the matching `-sources.jar` via `jvmsrcResolveSources` (`src/resolvers/gradle/resolve-sources-jar.ts`) and reads the `.java` from the ZIP (`zip-entry.ts`, `fflate`).
5. **Interface layer** — `src/cli.ts` (commander), `src/mcp.ts` (MCP tools), `src/public-api.ts` (library export `getClassSource`). All three are thin wrappers over `src/get-class-source.ts` and `src/resolve-with-cache.ts`.

`origin: interproject` reads depended-module **`src/main/java`** / **`src/test/java`** before external JARs. **`origin: local-file`** edges (Gradle `files(...)` JARs) participate in classpath search, **`get`**, and decompilation like external jars, except on-demand **`jvmsrcResolveSources`** applies to Maven **`external`** artifacts only. CFR decompilation (`src/decompiler/`) runs when sources are missing; results cache under global `decompiled/` (SPEC §6.2) with `sourceAvailable: false`. Optional **`JVMSRC_CFR_PATH`** / **`JVM_ORACLE_CFR_PATH`** override the bundled CFR JAR.

## Conventions

- **Errors are values, not exceptions.** Resolver and extractor pipelines return `{ ok: true, … } | { ok: false, message/error, … }`. Only corrupted-installation conditions (missing bundled resource) throw. Stable `code` values (SPEC §7) — `RESOLUTION_FAILED`, `SOURCES_RESOLVE_FAILED`, `INVALID_FQN`, `MODULE_NOT_FOUND`, `CONFIGURATION_NOT_FOUND`, `ZIP_READ_ERROR`, `CLASS_NOT_FOUND`, `DECOMPILE_FAILED` — are part of the public contract; don't rename without a release note.
- **`sourceAvailable`** is a public field on every source-bearing response (`true` = original source, `false` = decompiled). Preserve it across CLI / MCP / library.
- **CLI `get` stdout/stderr split** is intentional (SPEC §8.1.1): raw `.java` on stdout, one JSON metadata line on stderr, so `jvmsrc get … > Foo.java` works. `--quiet` suppresses the stderr line on success only. Phased **`[jvmsrc]`** progress and **`--verbose`** Gradle stderr are stderr-only (SPEC §8.1.1).
- **No project mutation.** Resolution must never write under the target project root — only `--init-script` with an external absolute path. Gradle's own global caches (`~/.gradle`) are fine.
- **Bundled resources** resolve from the package root via `src/bundled-resources.ts` (`getBundledResource`), not relative to `import.meta.url` or `process.cwd()`. The `BundledResourceName` union (`cfr.jar` | `analyzer-init.gradle`) is the allowlist.
- **Schema changes** to `ResolutionOutput` require bumping `schemaVersion` in `analyzer-init.gradle` and extending `SUPPORTED_RESOLUTION_SCHEMA_VERSIONS` in `resolution-output.ts`; cached `resolution.json` with unsupported versions are rejected, not migrated. **`1.1`** may omit null **`sourcesJarPath`** keys; **`normalizeResolutionOutput`** fills missing fields after parse.
- **Imports use `.js` extensions** even from `.ts` sources (ESM + Node resolution). `type: "module"` is set in `package.json`.
