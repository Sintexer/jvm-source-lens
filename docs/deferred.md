# Deferred items

Items here are known and understood. The team chose not to do them now.
Each item has a trigger. When the trigger happens, a maintainer can pick the item up.

| ID | Item | Why deferred | Trigger to revisit | Source |
|---|---|---|---|---|
| D1 | **Build-tool source roots.** Analyzers and the init script emit real source and output roots. `src/extractor/interproject-paths.ts` stops assuming `src/{main,test}/java` and `target/classes`. | Needs a `schemaVersion` bump. Old caches are rejected. No real project needs it. | A real project with a custom Gradle `sourceSets` layout, or a custom Maven `sourceDirectory` / `outputDirectory`. | Local review 2026-11, batch 11 |
| D2 | **JDK version and `MAVEN_OPTS` in the Maven digest.** | A profile that activates by `<jdk>` or by an environment property does not invalidate the cache. `forceRefresh` is a working escape. | A user reports a stale Maven result after a JDK or profile change. | SPEC §6.1 |
| D3 | **Gradle env-var versions in the digest.** | The digest cannot see `System.getenv()` calls in build scripts. Checkpoint 11 does not change this. | A user reports a stale Gradle result after an env change. | SPEC §6.1, PLAN checkpoint 11 |

## How to pick up an item

1. Write the failing test first (see [PLAN.md](../PLAN.md) rules).
2. Update [SPEC.md](../SPEC.md) when behavior or a schema changes.
3. Remove the row from this table in the same change.
