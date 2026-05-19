# Releasing

**Branch:** PRs → `master`. **Versioning:** [Release Please](https://github.com/googleapis/release-please) on push to `master` ([release-please.yml](.github/workflows/release-please.yml)) — opens `chore: release X.Y.Z` PR; merge it → tag + [npm](https://www.npmjs.com/package/jvmsrc) publish.

**Commits:** Squash-merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) titles (`feat:`, `fix:`, `feat!:`). No `Merge pull request #…` onto `master` — Release Please ignores those.

| Prefix | Bump |
|--------|------|
| `fix:` | patch |
| `feat:` | minor (`0.x` → minor per [config](release-please-config.json)) |
| `feat!:` / `BREAKING CHANGE:` | major |

**Ship:** merge features to `master` → review Release PR → merge Release PR. Don’t merge the Release PR before your feature is on `master`.

**npm CI:** [Trusted publishing](https://docs.npmjs.com/trusted-publishers) on package **jvmsrc** — repo `Sintexer/jvm-source-lens`, workflow `release-please.yml`, no `NPM_TOKEN` on publish. `package.json` `repository.url` must be `https://github.com/Sintexer/jvm-source-lens.git`.

**Pre-release check:** `bun run setup:cfr && bun run prepack && npm pack --dry-run`

**Manual publish:** `npm publish --access public` (`.npmrc` sets `provenance=false`; use `NPM_CONFIG_PROVENANCE=false` if needed). Prefer CI.

**Stuck?** No Release PR → conventional titles on `master`? Re-run workflow. Publish `E404` after provenance → fix trusted publisher repo/workflow match. Publish `EOTP` → remove `NODE_AUTH_TOKEN` from workflow; don’t use 2FA publish tokens in CI.
