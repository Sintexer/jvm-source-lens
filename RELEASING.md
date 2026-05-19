# Releasing jvmsrc

How we branch, version, and publish **jvmsrc** to [npm](https://www.npmjs.com/package/jvmsrc).

## Why `develop` and `master`?

| Branch | Role |
|--------|------|
| **`develop`** | Day-to-day integration — feature/fix PRs land here |
| **`master`** | Production line — only receives **Release PRs** from Release Please + hotfix merges |

We use this instead of **trunk-only on `master`** because:

- **`master` stays stable** — what users install from npm always matches a deliberate release merge.
- **`develop` absorbs WIP** — half-finished features do not block a releasable `master`.
- **Automatic semver** — Release Please reads [Conventional Commits](https://www.conventionalcommits.org/) on `develop` and proposes the right **major / minor / patch** bump.

**Trunk-based** (everything on `master`, tag often) is simpler for solo tools in early `0.x`, but couples “ready to ship” with “merged to default branch.” For a published library with MCP contracts, **develop + automated release PRs** scales better.

### Flow

```
develop ──●──●──●──●──●──►  (PRs from feature/*, fix/*)
            \
             └──► Release PR ──merge──► master ──tag v0.2.0──► npm
```

1. Merge work into **`develop`** (CI must pass).
2. **Release Please** opens/updates a PR titled e.g. `chore: release 0.2.0` **into `master`** (bumps `package.json`, updates `CHANGELOG.md`).
3. Review and **merge** that Release PR.
4. Release Please creates tag **`v0.2.0`** on `master` and the **publish** job runs ([release-please.yml](.github/workflows/release-please.yml)).

No manual version bump or `git tag` commands.

## Branching

| Branch | Branched from | Merges to | Purpose |
|--------|---------------|-----------|---------|
| **`develop`** | `develop` | `develop` via PR | Integration (default for PRs) |
| **`master`** | — | — | Releases only (via Release Please PR) |
| **`feature/<name>`** | `develop` | `develop` | New behavior |
| **`fix/<name>`** | `develop` | `develop` | Bug fixes |
| **`hotfix/<name>`** | `master` | `master` + backport to `develop` | Urgent production fix |

**Hotfix:** branch from `master`, fix, merge to `master` (Release Please will patch-release), then merge `master` → `develop` so branches do not diverge.

### First-time repo setup

If `develop` does not exist yet:

```bash
git checkout master
git pull
git checkout -b develop
git push -u origin develop
```

Set **default branch** to **`develop`** in GitHub (Settings → General) so new PRs target integration.

Protect **`master`**: require PR, require CI, no direct pushes.

## Automatic semantic versioning

Versions come from **[Release Please](https://github.com/googleapis/release-please)** ([config](release-please-config.json), [manifest](.release-please-manifest.json)).

### Commit messages (required for correct bumps)

Use [Conventional Commits](https://www.conventionalcommits.org/) on PR titles or squash-merge messages:

| Commit | SemVer bump | Example |
|--------|-------------|---------|
| `fix:` | **patch** | `fix: handle missing sources JAR` |
| `feat:` | **minor** | `feat: add search_classes limit` |
| `feat!:` or `BREAKING CHANGE:` in body | **major** | `feat!: rename MCP error code` |

Non-user-facing work: `chore:`, `ci:`, `docs:`, `test:`, `refactor:` — typically no version bump unless they include a breaking footer.

While **`0.x`**, Release Please is configured with `bump-minor-pre-major` so `feat:` still bumps **minor** (0.1.0 → 0.2.0), not 1.0.0.

### Maintainer release steps

1. Ensure changes are on **`develop`** with conventional commit messages.
2. Wait for (or re-run) **Release Please** — open PR **into `master`**.
3. Review `CHANGELOG.md` + `package.json` version in that PR.
4. **Merge** the Release PR → tag + npm publish run automatically.

### Secrets

| Secret | Purpose |
|--------|---------|
| **`NPM_TOKEN`** | npm publish (Automation token) |
| `GITHUB_TOKEN` | Provided by Actions (Release Please PRs + releases) |

## What CI runs when

| Event | Workflow |
|-------|----------|
| PR / push to `develop` or `master` | [ci.yml](.github/workflows/ci.yml) |
| Push to `develop` or `master` | [release-please.yml](.github/workflows/release-please.yml) (opens/updates Release PR; publishes when release merges) |

## Local checks

```bash
bun install
bun run setup:cfr
bun run prepack
bun run verify:publish
npm pack --dry-run
```

## After release

```bash
npm view jvmsrc version
```

Users: `npm install -g jvmsrc@latest` or `npx jvmsrc@X.Y.Z`.
