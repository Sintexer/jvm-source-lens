# Contributing to jvmsrc

Thanks for helping improve **JVM Source Lens**.

## Prerequisites

- **[Bun](https://bun.sh)** ≥ 1.3 (runtime, tests, and builds)
- **Java** on `PATH` (decompilation / `javap` in tests)

End users install the published package with **npm** (`npm install -g jvmsrc`); this repo uses **Bun only** for development and CI.

## Setup

```bash
git clone https://github.com/Sintexer/jvm-source-lens.git
cd jvm-source-lens

bun install
bun run setup:cfr    # once — downloads CFR into resources/cfr.jar
```

## Day to day

```bash
bun run dev:cli -- get com.example.Foo -p /path/to/gradle-project
bun run dev:mcp
bun test
bun run typecheck
bun run build
```

Production-like check (what CI runs before publish):

```bash
bun run prepack              # typecheck + build + validate:resources
bun run verify:publish
```

Run built CLI without linking:

```bash
bun run build
node dist/cli.js get com.example.Foo -p /path/to/project
```

`jvmsrc config` via `bun run src/cli.ts` emits an MCP snippet for `bun run src/mcp.ts`. After `bun run build`, use `node dist/cli.js mcp` or link the package for a global `jvmsrc` shim.

**Agent-facing copy** (MCP tool descriptions, server instructions, empty/failure messages) lives under [`src/copy/`](src/copy/) — edit there when tuning what agents see; `src/mcp.ts` wires tools only.

## Test layout

Tests live in two places:

| Location | What it contains |
|---|---|
| `src/**/*.test.ts` | Unit tests, co-located with source files. Run always; no Gradle needed. |
| `test/fixtures/` | Fast regression tests using **synthetic** `ResolutionOutput` (no real `gradlew`). |
| `test/scenarios/` | Real-Gradle **scenario tests** — require wrapper JARs (see below). |

### Gradle smoke fixture (fast, synthetic)

`test/fixtures/gradle-smoke/` is a committed multi-module project used by
`test/fixtures/gradle-smoke-fixture.test.ts`.  The test builds a `ResolutionOutput` by hand and
never calls `gradlew`, so it runs in CI without any extra setup.

```bash
# Only needed if you want to invoke real Gradle against this fixture locally:
bun run ensure:gradle-smoke-wrapper
```

### Scenario tests (real Gradle)

`test/scenarios/` contains integration-style scenarios that invoke real Gradle. Each scenario is a
self-contained subdirectory under `test/scenarios/{build-tool}/{scenario-name}/` with:

- one or more Gradle projects (committed source, gitignored wrapper JAR)
- a co-located `scenario.test.ts`

Current scenarios:

| Path | What it tests |
|---|---|
| `gradle/multi-module/` | Inter-project source resolution (`origin: interproject`) and resolution cache hit |
| `gradle/local-maven-publish/` | Snapshot publish → resolve → republish with new method → automatic cache invalidation via local-artifact digest (no `forceRefresh` required) |
| `gradle/dependency-change/` | Edit `build.gradle` to bump a stable dependency version → build-input digest changes → automatic re-resolution; cache hit when nothing changes |
| `gradle/version-conflict/` | Direct dep (v2) and transitive dep (v1) of the same library — tool reports exactly the version Gradle selected (highest-wins), not a stale or wrong-version JAR |

Stub directories `scenarios/maven/` and `scenarios/bazel/` reserve space for future build systems.

**Generating wrapper JARs** (one-time, requires `gradle` on `PATH`):

```bash
bun run ensure:scenario-wrappers
```

This runs `scripts/ensure-scenario-wrappers.sh`, which generates `gradle-wrapper.jar` for every
Gradle project under `test/scenarios/gradle/`. The JARs are gitignored; the script is idempotent
(skips projects that already have a JAR).

Scenario tests use `describe.skipIf(!wrapperJar)` — they are silently skipped in CI when the JAR
is absent, so `bun test` always succeeds without Gradle.

**Running scenario tests locally:**

```bash
bun run ensure:scenario-wrappers   # once
bun test test/scenarios            # run only scenario tests
bun test                           # run all tests (scenarios auto-skip if no JAR)
```

**Adding a new scenario:**

1. Create `test/scenarios/{build-tool}/{scenario-name}/` with the fixture project(s).
2. Add a `scenario.test.ts` co-located with the fixture, guarded by `describe.skipIf(!wrapperJar)`.
3. Register the project path in `scripts/ensure-scenario-wrappers.sh` (or the equivalent script for
   the new build tool).
4. Add a `"ensure:{tool}-{scenario}"` script in `package.json` if convenient.

## Branches

- Open PRs against **`master`** (default integration and release branch).
- **Release Please** opens version-bump PRs into **`master`** — see [RELEASING.md](RELEASING.md).

## Commit messages (semver)

We use **Conventional Commits** for automatic versioning. Prefer these PR titles (squash merge):

| Prefix | Meaning |
|--------|---------|
| `feat:` | New feature → **minor** bump |
| `fix:` | Bug fix → **patch** bump |
| `feat!:` or `BREAKING CHANGE:` | Breaking API → **major** bump |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:` | No release bump (usually) |

Examples: `feat: add JVMSRC_ALLOWED_ROOTS`, `fix: cap MCP source output size`.

## Before you open a PR

1. `bun test`, `bun run typecheck`, `bun run prepack`
2. Commit **`bun.lock`** with any `package.json` dependency change (`bun install`)
3. Update [SPEC.md](SPEC.md) / [README.md](README.md) / [ROADMAP.md](ROADMAP.md) as needed

CI: `bun install --frozen-lockfile`, `bun audit`, `bun test`, `bun run prepack`, `bun run verify:publish`.

Locally after dependency updates: `bun run audit:ci`.

## Releases

Versioning, branching, and npm publish: **[RELEASING.md](RELEASING.md)**. Update [CHANGELOG.md](CHANGELOG.md) with user-facing changes.

## Docs map

| File | Use |
|------|-----|
| [SPEC.md](SPEC.md) | Authoritative behavior and contracts |
| [README.md](README.md) | Install and usage for end users |
| [RELEASING.md](RELEASING.md) | Branching and release process |
