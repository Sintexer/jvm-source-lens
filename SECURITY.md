# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest release on npm | Yes |
| Previous major / minor | Best-effort security fixes on `master`, released as patches |

Release process: [RELEASING.md](RELEASING.md).

Report issues against the latest published version when possible.

## Reporting a vulnerability

Please **do not** open public GitHub issues for security-sensitive reports.

1. Use [GitHub private vulnerability reporting](https://github.com/Sintexer/jvm-source-lens/security/advisories/new) for this repository, **or**
2. Email the maintainer listed in [package.json](package.json) / repository contacts.

Include steps to reproduce, impact, and affected versions. We aim to acknowledge reports within a few business days.

## Trust boundary

`jvmsrc` runs **locally** on your machine. It does **not** send project source, class names, or resolution output to any remote service (no telemetry).

### Processes spawned

| Process | When | Input |
|---------|------|--------|
| `gradlew` / `gradle` | Resolution, sources JAR fetch | Fixed task names + bundled init script path (see [Gradle wrapper trust](#gradle-wrapper-trust)) |
| `java` (CFR) | Decompile when no sources JAR | JAR path from Gradle resolution |
| `javap` | Signatures / structure fallback | Class name + classpath from resolution |
| `sh` (Unix only) | Run non-executable `gradlew` | Wrapper script path only — not user-controlled |

Subprocesses use an **argv array** via `cross-spawn` / `Bun.spawn` with **`shell: false`** (never `/bin/sh -c …` with interpolated user input). See [src/spawn-child.ts](src/spawn-child.ts).

### Gradle wrapper trust

Resolution runs the project's own `./gradlew`, which starts `gradle/wrapper/gradle-wrapper.jar` and downloads the distribution named in `gradle/wrapper/gradle-wrapper.properties`. These files come from the repository and run with your user rights. The project's `build.gradle(.kts)`, `settings.gradle(.kts)` and plugins also run, as in any Gradle build.

For a repository you do not trust:

- Check `distributionUrl` and set `distributionSha256Sum` in `gradle-wrapper.properties`, and verify `gradle-wrapper.jar` (for example with [gradle/actions/wrapper-validation](https://github.com/gradle/actions)).
- Or set **`JVMSRC_USE_SYSTEM_GRADLE=1`** so jvmsrc runs `gradle` from your `PATH` and does not run the project's wrapper.

`JVMSRC_USE_SYSTEM_GRADLE` does not make the build safe: the build scripts still run. Use jvmsrc only on projects you would build yourself.

### Untrusted bytecode

Dependency JARs may contain malicious bytecode. CFR and `javap` execute or analyze that bytecode in a local JDK process — same practical trust level as running Gradle on the project. Use only on projects and dependencies you trust.

Decompiled output (`sourceAvailable: false`) is useful for exploration but **not** authoritative for security reviews, secrets, or crypto.

### Project paths

`projectRoot` (CLI `-p`, MCP tools) selects which Gradle tree to analyze. Point it only at repositories you intend to inspect.

Optional **`JVMSRC_ALLOWED_ROOTS`**: comma-separated absolute directories; any `projectRoot` must lie under one of them (see README).

### Data written locally

All caches and diagnostics stay on disk under configurable roots (see README **Local data**). Nothing is uploaded by the tool.

## Dependency updates

Runtime dependencies are pinned in **`bun.lock`**. CI runs `bun install --frozen-lockfile` and **`bun audit`** on every push/PR; [Dependabot](.github/dependabot.yml) opens weekly update PRs for Bun and GitHub Actions. Users should keep `jvmsrc` updated.

## Safe configuration

- Prefer **`npx -y jvmsrc@<version> mcp`** with a pinned version in MCP config for reproducibility.
- Set **`JVMSRC_ALLOWED_ROOTS`** in shared/CI environments when MCP agents can pass arbitrary paths.
- Override **`JVMSRC_CFR_PATH`** only with JARs your organization has reviewed.
- Set **`JVMSRC_USE_SYSTEM_GRADLE=1`** when agents can point jvmsrc at repositories whose Gradle wrapper you have not reviewed.
