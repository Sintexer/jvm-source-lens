# Releasing

**Branch:** PRs → `master`. **Versioning:** [Release Please](https://github.com/googleapis/release-please) on push to `master` ([release-please.yml](.github/workflows/release-please.yml)) — opens `chore: release X.Y.Z` PR; merge it → tag + [npm](https://www.npmjs.com/package/jvmsrc) publish.

**Commits:** Squash-merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) titles (`feat:`, `fix:`, `feat!:`). No `Merge pull request #…` onto `master` — Release Please ignores those.

| Prefix | Bump |
|--------|------|
| `fix:` | patch |
| `feat:` | minor (`0.x` → minor per [config](release-please-config.json)) |
| `feat!:` / `BREAKING CHANGE:` | major |

**Ship:** merge features to `master` → review Release PR → merge Release PR. Don’t merge the Release PR before your feature is on `master`.

**MCP registry:** [server.json](server.json) top-level `version` and `packages[0].version` are bumped with `package.json` via Release Please `extra-files` in [release-please-config.json](release-please-config.json). The workflow must **not** set `release-type` on the action (manifest mode only). CI runs `bun run validate:server-json`.

**Tags / changelog:** Manifest mode defaults to `jvmsrc-v1.x.x` tags unless `include-component-in-tag: false` in [release-please-config.json](release-please-config.json). Use **`v1.x.x`** only so Release Please finds prior tags and keeps incremental changelog diffs. If a bad `jvmsrc-v*` tag or release PR exists, delete the tag and close that PR, merge the config fix, then re-run the workflow.

**npm CI:** [Trusted publishing](https://docs.npmjs.com/trusted-publishers) on package **jvmsrc** — repo `Sintexer/jvm-source-lens`, workflow `release-please.yml`, no `NPM_TOKEN` on publish. `package.json` `repository.url` must be `https://github.com/Sintexer/jvm-source-lens.git`.

**MCP Registry CI:** Job `publish-mcp` runs after `publish-npm`. It uses [`mcp-publisher`](https://github.com/modelcontextprotocol/registry) (`login github-oidc` → `publish`) with [server.json](server.json). It needs `id-token: write`. `package.json` `mcpName` must match `server.json` `name` (`io.github.Sintexer/jvmsrc`). No extra secrets for OIDC. npm takes a few minutes to show a new version, so the job retries for about 5 minutes. A re-run of `publish-npm` skips `npm publish` when that version is already public.

**Registry publish failed, npm already has the version:** do not re-run the release job. `npm publish` then fails with "cannot publish over" the existing version. Wait until `npm view jvmsrc@<version> version` prints the version. Then run this workflow with **Run workflow** and **Publish server.json to the MCP registry only** checked. That runs `publish-mcp` and does not publish to npm.

**Pre-release check:** `bun run setup:cfr && bun run prepack && npm pack --dry-run`

**Manual publish:** `npm publish --access public` (`.npmrc` sets `provenance=false`; use `NPM_CONFIG_PROVENANCE=false` if needed). Prefer CI.

**Stuck?** No Release PR → conventional titles on `master`? Re-run workflow. Publish `E404` after provenance → npm trusted publisher must match `Sintexer/jvm-source-lens` + `release-please.yml` (Environment **empty**); CI uses `env -u NODE_AUTH_TOKEN npm publish` and `npm@11.6.2`. Publish `EOTP` → don’t use `NPM_TOKEN` with 2FA in CI.
