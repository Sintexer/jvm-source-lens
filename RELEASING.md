# Releasing jvmsrc

How we branch, version, and publish **jvmsrc** to [npm](https://www.npmjs.com/package/jvmsrc).

## Branch model

**`master`** is the only release branch. [Release Please](https://github.com/googleapis/release-please) scans **conventional commits on `master`**, opens a Release PR into **`master`**, and tags on merge.

```
feature/* ──PR (feat:/fix: squash title)──► master
                                            │
                                            └── Release PR ──merge──► master ──tag──► npm
```

Do **not** ship by merging a side branch into `master` with a title like `Merge pull request #N from …` — Release Please cannot parse that for semver. Merge work via PRs to **`master`** with [Conventional Commits](https://www.conventionalcommits.org/) squash titles.

### Flow

1. Merge features/fixes into **`master`** (PR titles like `feat: add init skill`, `fix: …`).
2. **Release Please** runs on each push to **`master`** and opens/updates a PR e.g. `chore: release 1.1.0` **into `master`**.
3. Review the Release PR — merge it when the changelog matches what you want to ship.
4. Merging the Release PR creates the tag and runs **`npm publish`** ([release-please.yml](.github/workflows/release-please.yml)).

No manual version bump or `git tag` commands.

### Why a Release PR can appear before your feature

Release Please only sees **commits already on `master`**. If other `feat:` / `fix:` commits landed first, a Release PR is expected while your feature PR is still open. Merge the feature to **`master`** before merging the Release PR.

## Branching

| Branch | Branched from | Merges to | Purpose |
|--------|---------------|-----------|---------|
| **`master`** | `master` | `master` via PR | Default integration + releases |
| **`feature/<name>`** | `master` | `master` | New behavior |
| **`fix/<name>`** | `master` | `master` | Bug fixes |

Set **default branch** to **`master`** in GitHub (Settings → General). Protect **`master`**: require PR, require CI.

## Automatic semantic versioning

Versions come from **Release Please** ([config](release-please-config.json), [manifest](.release-please-manifest.json)).

### Commit messages (required)

Use conventional titles on PR squash merge:

| Commit | SemVer bump | Example |
|--------|-------------|---------|
| `fix:` | **patch** | `fix: handle missing sources JAR` |
| `feat:` | **minor** | `feat: add search_classes limit` |
| `feat!:` or `BREAKING CHANGE:` in body | **major** | `feat!: rename MCP error code` |

`chore:`, `ci:`, `docs:`, `test:`, `refactor:` — usually no version bump unless breaking.

While **`0.x`**, `bump-minor-pre-major` makes `feat:` bump **minor** (0.1.0 → 0.2.0).

### Maintainer release steps

1. Merge intended work into **`master`** (conventional squash-merge titles).
2. Confirm the **Release PR → `master`** lists the right changes (re-run **Actions → release-please** on `master` if needed).
3. **Merge** the Release PR — npm publish runs automatically.

### If the Release PR is wrong or too early

| Situation | What to do |
|-----------|------------|
| Feature not on `master` yet | Leave Release PR unmerged; merge feature to `master`; PR updates on next push |
| Release PR merged too early | Merge feature to `master`; wait for the next Release PR |
| Stale Release PR | Close it if the base is wrong; re-run **release-please** on `master` |
| Old PR targeted wrong branch | Close stale Release PR (e.g. into `develop`); re-run on `master` |

### Secrets

| Secret | Purpose |
|--------|---------|
| **`NPM_TOKEN`** | npm publish (Automation token) |
| `GITHUB_TOKEN` | Release Please PRs + GitHub releases |

## What CI runs when

| Event | Workflow |
|-------|----------|
| PR to `master` or push to `master` | [ci.yml](.github/workflows/ci.yml) |
| Push to `master` | [release-please.yml](.github/workflows/release-please.yml) |

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

### Manual publish from your machine

```bash
bun run setup:cfr && bun run prepack
npm pack --dry-run
npm publish --access public
```

Repo **`.npmrc`** sets `provenance=false` for local publishes. CI uses `npm publish --provenance` in GitHub Actions only.

If you still see `provider: null`, check global config: `npm config get provenance` (should be `false`) and `grep provenance ~/.npmrc`. Then:

```bash
NPM_CONFIG_PROVENANCE=false npm publish --access public
```

## Troubleshooting Release Please

### `commit could not be parsed: Merge pull request #…` and `No commits for path: ., skipping`

**Cause:** The newest commit on **`master`** is a merge commit, not a conventional title.

**Fix:** Merge features via PRs to **`master`** with `feat:` / `fix:` squash titles. Do not bulk-merge another branch into `master` to release. Close any stale Release PR and re-run the workflow after conventional commits are on `master`.

### No Release PR after merging a feature

**Cause:** Commits on `master` since the last tag are not conventional (`Merge …`, `Update files`, etc.), or a stale Release PR is still open with the wrong base.

**Fix:** Verify squash-merge titles on merged PRs. Close outdated Release PRs. Re-run **release-please** on **`master`**.
