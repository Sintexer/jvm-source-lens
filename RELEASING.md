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

1. Merge **everything you want in the release** into **`develop`** first (feature PRs → `develop`, not straight to `master`).
2. **Release Please** runs on each push to **`develop`** and opens/updates a PR e.g. `chore: release 0.2.0` **into `master`** (version + `CHANGELOG` from commits **already on `develop`**).
3. **Review that Release PR** — if a feature is still on a feature branch, **do not merge** the release PR yet; merge the feature to `develop` first, then wait for the Release PR to update (or re-run the workflow).
4. **Merge** the Release PR into **`master`** → tag + **`npm publish`** ([release-please.yml](.github/workflows/release-please.yml)).

No manual version bump or `git tag` commands.

### Why a Release PR can appear “before” your feature

Release Please does **not** wait for open feature PRs. It only sees **commits on `develop`**. Typical timeline:

```
feature/xyz ──(open PR)──► develop          Release PR opened from earlier develop commits
                \
                 └── merge later ──► develop  → Release PR updates on next push / workflow run
```

So if `develop` already had releasable commits (`feat:`, `fix:`, etc.) from other work, a Release PR to `master` is **expected** even while `feature/xyz` is still in review. That is not a bug — **merge the feature to `develop` before merging the Release PR to `master`**.

If you **already merged** a Release PR to `master` without the feature: the feature is on `develop` only — ship another release after it lands on `develop` (a new Release PR will follow).

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

1. Merge all intended work into **`develop`** (conventional commit titles on squash merge).
2. Confirm the **Release PR → `master`** lists the right changes (re-run **Actions → release-please → Run workflow** on `develop` if needed).
3. **Merge** the Release PR only when complete — not when features are still only on side branches.
4. npm publish runs automatically on that merge.

### If the Release PR is wrong or too early

| Situation | What to do |
|-----------|------------|
| Feature not on `develop` yet | **Close** or leave the Release PR unmerged; merge feature to `develop`; Release PR updates on next `develop` push |
| Release PR merged too early | Merge feature to `develop`; wait for the **next** Release PR; publish another version |
| Stale Release PR after many merges | Re-run **release-please** workflow on `develop` or push an empty commit to `develop` |

### Secrets

| Secret | Purpose |
|--------|---------|
| **`NPM_TOKEN`** | npm publish (Automation token) |
| `GITHUB_TOKEN` | Provided by Actions (Release Please PRs + releases) |

## What CI runs when

| Event | Workflow |
|-------|----------|
| PR / push to `develop` or `master` | [ci.yml](.github/workflows/ci.yml) |
| Push to `develop` or `master` | [release-please.yml](.github/workflows/release-please.yml) (Release Please + `npm publish` on release) |

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
