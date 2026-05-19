# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest release on npm | Yes |
| Older minors | Best-effort fixes only |

Report issues against the latest published version when possible.

## Reporting a vulnerability

Please **do not** open public GitHub issues for security-sensitive reports.

1. Use [GitHub private vulnerability reporting](https://github.com/Sintexer/jvm-dependency-resolver/security/advisories/new) for this repository, **or**
2. Email the maintainer listed in [package.json](package.json) / repository contacts.

Include steps to reproduce, impact, and affected versions. We aim to acknowledge reports within a few business days.

## Trust boundary

`jvmsrc` runs **locally** on your machine. It does **not** send project source, class names, or resolution output to any remote service (no telemetry).

### Processes spawned

| Process | When | Input |
|---------|------|--------|
| `gradlew` / `gradle` | Resolution, sources JAR fetch | Fixed task names + bundled init script path |
| `java` (CFR) | Decompile when no sources JAR | JAR path from Gradle resolution |
| `javap` | Signatures / structure fallback | Class name + classpath from resolution |
| `sh` (Unix only) | Run non-executable `gradlew` | Wrapper script path only — not user-controlled |

Subprocesses use an **argv array** via `cross-spawn` / `Bun.spawn` with **`shell: false`** (never `/bin/sh -c …` with interpolated user input). See [src/spawn-child.ts](src/spawn-child.ts).

### Untrusted bytecode

Dependency JARs may contain malicious bytecode. CFR and `javap` execute or analyze that bytecode in a local JDK process — same practical trust level as running Gradle on the project. Use only on projects and dependencies you trust.

Decompiled output (`sourceAvailable: false`) is useful for exploration but **not** authoritative for security reviews, secrets, or crypto.

### Project paths

`projectRoot` (CLI `-p`, MCP tools) selects which Gradle tree to analyze. Point it only at repositories you intend to inspect.

Optional **`JVMSRC_ALLOWED_ROOTS`**: comma-separated absolute directories; any `projectRoot` must lie under one of them (see README).

### Data written locally

All caches and diagnostics stay on disk under configurable roots (see README **Local data**). Nothing is uploaded by the tool.

## Dependency updates

Runtime dependencies are pinned in `package-lock.json`. CI runs `npm ci` and **`npm audit --audit-level=high`** on every push/PR; [Dependabot](.github/dependabot.yml) opens weekly update PRs for npm and GitHub Actions. Users should keep `jvmsrc` updated.

## Safe configuration

- Prefer **`npx -y jvmsrc@<version> mcp`** with a pinned version in MCP config for reproducibility.
- Set **`JVMSRC_ALLOWED_ROOTS`** in shared/CI environments when MCP agents can pass arbitrary paths.
- Override **`JVMSRC_CFR_PATH`** only with JARs your organization has reviewed.
