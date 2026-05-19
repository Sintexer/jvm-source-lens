# Contributing to jvmsrc

Thanks for helping improve **JVM Source Lens**.

## Prerequisites

- **Node.js ≥ 20**
- **Java** on `PATH` (tests and decompilation paths)
- **[Bun](https://bun.sh)** for `bun test` (the test runner; not required for a production `npm run build`)

## First-time setup

```bash
git clone https://github.com/Sintexer/jvm-dependency-resolver.git
cd jvm-dependency-resolver
```

Then choose **npm** or **Bun** workflow below. Both need CFR once:

```bash
npm run setup:cfr    # or: bun run setup:cfr
```

## npm workflow (build `dist/`)

```bash
npm ci               # or: npm install
npm run build
npm run validate:resources
```

Run the CLI without linking:

```bash
node dist/cli.js get com.example.Foo -p /path/to/gradle-project
node dist/cli.js mcp
```

Optional global shim from this checkout: `npm link` → `jvmsrc …`.

| Task | Command |
|------|---------|
| Typecheck | `npm run typecheck` |
| Pre-publish check | `npm run prepack` |
| Tests | `bun test` |

## Bun workflow (iterate on TypeScript)

```bash
bun install
bun run dev:cli -- get com.example.Foo -p /path/to/project
bun run dev:mcp
bun test
bun run typecheck
```

Production bundle when needed: `npm run build` (or `bun run build:bun`).

`jvmsrc config` run via `bun run src/cli.ts` emits an MCP snippet that points at `bun run src/mcp.ts`; after `npm link` + `npm run build` it emits `jvmsrc mcp`.

## Gradle smoke fixture

Real `gradlew` runs against `test/fixtures/gradle-smoke` need a generated wrapper JAR (not committed):

```bash
bun run ensure:gradle-smoke-wrapper
```

Requires `gradle` on `PATH` once. Most CI tests use synthetic resolution and do not need this.

## Before you open a PR

1. `bun test` and `npm run typecheck`
2. If behavior or schemas change: update [SPEC.md](SPEC.md); user-facing install/usage: [README.md](README.md)
3. Shipped features: check [ROADMAP.md](ROADMAP.md)

CI also runs a **build hygiene** job: `npm ci`, `npm audit` (high+), `npm run prepack`, and `npm run verify:publish`. Keep `package-lock.json` in sync when changing dependencies (`npm install`).

Locally: `npm run audit:ci` after dependency updates.

## Docs map

| File | Use |
|------|-----|
| [SPEC.md](SPEC.md) | Authoritative behavior and contracts |
| [README.md](README.md) | Install and usage for end users |
