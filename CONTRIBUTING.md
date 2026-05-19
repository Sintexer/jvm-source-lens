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

## Gradle smoke fixture

```bash
bun run ensure:gradle-smoke-wrapper
```

Requires `gradle` on `PATH` once (wrapper JAR not committed). Most tests use synthetic resolution and do not need this.

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
