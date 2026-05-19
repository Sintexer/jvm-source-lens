# Changelog

All notable changes to **jvmsrc** are documented in this file.

This file is updated by **[Release Please](https://github.com/googleapis/release-please)** when a release PR merges to `master`. Contributors use **Conventional Commits** on PRs to `develop` — see [RELEASING.md](RELEASING.md).

## [0.1.0](https://github.com/Sintexer/jvm-dependency-resolver/releases/tag/v0.1.0) (2026-05-19)

### Features

- Gradle classpath resolution via bundled init script
- CLI (`jvmsrc get`, `resolve`, `find-in-class`, `config`, `diagnostics`, `mcp`)
- MCP tools: `get_class_source`, `get_method_signature`, `get_class_structure`, `search_classes`, `find_in_class_source`, `resolve_dependencies`
- Resolution cache, CFR decompilation fallback, structured error codes
- Agent skill ([SKILL.md](SKILL.md))
