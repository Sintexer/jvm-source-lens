# jvmsrc plan

This is the only plan for **JVM Source Lens** (`jvmsrc`). Behavior and schemas are in [SPEC.md](SPEC.md).
The plan replaces `ROADMAP.md`, `docs/mcp-ux-todo.md` and `docs/mcp-ux-baseline.md`.

## Rules

1. Do the checkpoints in order. A later checkpoint can start only when the previous one is released.
2. **Each checkpoint gives a fully working app.** Before you close a checkpoint, make sure that all of these are true:
   - `bun test` passes.
   - `bun run prepack` passes (typecheck, build, bundled resources).
   - The scenario tests pass locally (`bun run ensure:scenario-wrappers`, then `bun test test/scenarios`).
   - A manual smoke test passes on `test/evals/project`: `jvmsrc get`, plus one MCP call (`bun run dev:mcp`).
   - SPEC, README and CHANGELOG show the new behavior.
3. Release one version for each checkpoint (release-please). Do not put two checkpoints in one release.
4. Use TDD. Write the failing test first. Name Java fixture tests `shouldXWhenY`.
5. A public contract change (error `code`, response field, schema version) needs a SPEC §7 update and a release note.
6. When a step is done, change `- [ ]` to `- [x]`. Check a checkpoint only when all of its steps are done.

## Status

Shipped: P0 MVP, P1 polish, P2 features, agent-UX checkpoints 0–6 (see CHANGELOG up to 1.18.0).

| # | Checkpoint | Why at this position | Size |
|---|---|---|---|
| 1 | Security hardening | Open promises from the 2026-05 audit | S |
| 2 | Contract and docs debt | Small fixes. They make later releases clean | S |
| 3 | Eval baseline and agent-UX tuning | Gives the numbers that later checkpoints are measured against | M |
| 4 | Nested classes: source | Known eval failure (`s04`) | M |
| 5 | Nested classes: structure, decompile, search | Completes nested classes | M |
| 6 | Non-Java source lookup (Kotlin, Scala, Groovy) | Kotlin libraries return real source, not CFR output | M |
| 7 | Kotlin declarations | Structure, KDoc and excerpts for `.kt` | L |
| 8 | Build-tool-neutral core | Gives a stable base for Maven. No behavior change | M |
| 9 | Maven: external dependencies | Second build tool | L |
| 10 | Maven: reactor modules and polish | Maven reaches the same level as Gradle | M |
| 11 | Gradle cache gaps (`buildSrc`, env, composite) | Removes the need for `forceRefresh` | M |
| 12 | Package and javadoc-JAR documentation | New capability | L |
| 13 | Hierarchy tools | New capability, low frequency | L |
| 14 | Exploration: more build tools and decompilers | Optional. Only spikes | — |

---

## Checkpoint 1 — Security hardening

**Goal:** close all open audit items. There is no change to the public API.

- [x] **JAR size guard.** Before `readFileSync`, do a `statSync` size check in `readZipEntryUtf8` / `zipEntryExists` (`src/extractor/zip-entry.ts`) and in all other full-JAR reads (find them with `grep readFileSync`). Add the `JVMSRC_MAX_JAR_BYTES` setting (default 500 MB). If the JAR is too large, return `ZIP_READ_ERROR` with the size and the limit in the message. Do not add a new code.
- [x] **Symlinked directories in the cache walk.** In `walk()` (`src/cache/index.ts`), use `lstatSync` and skip entries where `isSymbolicLink()` is true. Test: make a symlink loop, then make sure the walk stops and the digest is stable.
- [x] **`gradlew` trust model.** Add a section to SECURITY.md and a note to SPEC. Add `JVMSRC_USE_SYSTEM_GRADLE=1`, which makes jvmsrc use `gradle` on `PATH` instead of `./gradlew`. Test this in `gradle-wrapper-command.test.ts`.
- [x] **ReDoS guard for `find_in_class_source` regex mode.** Run the regex in a Worker thread with a wall-clock deadline (default 2 s; `JVMSRC_REGEX_TIMEOUT_MS`). Do not add a new dependency. On timeout, return an error value with a clear message. Test with `(a+)+$`.

**Done when:** the four tests pass and the app works as before on the eval project.

## Checkpoint 2 — Contract and docs debt

**Goal:** make the docs agree with the current behavior. Remove small rough edges that are visible to agents.

- [ ] SPEC §7: document the `MODULE_NOT_FOUND` "matches several modules" variant. Add `JVMSRC_PROJECT_ROOT` to the configuration table.
- [ ] `MODULE_AMBIGUOUS` text: do not repeat the class name when the message already names it.
- [ ] Resolution notes: show one footer line for "resolved `Foo` → `com.x.Foo`" (`resolvedFrom`) and for a lifted `projectRoot` (`note` from `resolveProjectRoot`). If a value is not useful, remove that field.
- [ ] Cache cleanup: delete the orphaned single-slot `class-search-index.json` from a bucket when the bucket loads.
- [ ] Copy drift: compare README, `server.json`, CONTRIBUTING and the hook docs with the current MCP tool descriptions. Fix old wording (for example "regex or substring searches", "projectRoot is required").
- [ ] CHANGELOG: make sure that it lists these breaking changes: `scope: 'full'` was removed, a subdirectory `projectRoot` now resolves to the build root, and `INVALID_FQN` is reused for the simple-name pick list. Add the missing ones to the next release note.

**Done when:** a reviewer can read SPEC §7 and §8.2 and find no difference from the tool output on the eval project.

## Checkpoint 3 — Eval baseline and agent-UX tuning

**Goal:** get current numbers, then fix the gaps that the data shows. Write the results in [test/evals/README.md](test/evals/README.md#results).

- [ ] Run the full eval three times: default, `--with-hook` and `--mode competing`. This also gives the first live test of the `PreToolUse` hook: make sure that the deny reason reaches the agent.
- [ ] Targets: first-call success ≥ 95%, `filecontext` module correct ≥ 90%, shell fallback 0% with the hook. If a target is not met, make the change that the transcripts show (tool description or result footer), then run the failed prompts again.
- [ ] Eager tokens ≤ 2,000 (today 2,478). Remove schema noise: `$schema`, `maximum: 9007199254740991` from `.int()`, `additionalProperties: {}`, and parameters that agents seldom use.
- [ ] `measure:tokens`: replace `chars / 4` with a real tokenizer count.
- [ ] If the file path is under `/src/test/`, infer `includeTest: true`.
- [ ] Performance on large builds: make a synthetic 50-module fixture. Measure the first `search_classes` call without `modulePath` and the double probe in `canonicalizeClassName` / `inferModulePath`. If the first call takes more than 10 s, add a project-wide index or a module cap. If `durationMs` shows a cost for `roots/list`, cache it (invalidate on `roots/list_changed`).
- [ ] CLI parity: make `--project` optional. Use the same discovery as MCP (env, cwd, lift to the build root).

**Done when:** the README results table has a full run, and each target is met or has a recorded reason.

## Checkpoint 4 — Nested classes: source

**Problem:** `get_class_source com.google.common.collect.ImmutableList$Builder` returns `DECOMPILE_FAILED`. The lookup asks for `ImmutableList$Builder.java`, but that file does not exist.

- [ ] **Spike:** on guava `ImmutableList`, check what CFR does with the inner class alone and with the outer class. Record the result here. Decide the shape of the decompile fallback for checkpoint 5.
- [ ] **Locator:** `locateTypeDeclaration(source, ['Outer', 'Inner', …])` → `{ start, openBrace, closeBrace }`. `start` includes the Javadoc and annotations before the declaration. Reuse `findTopLevelTypeKeywordMatch`, `findTypeBodyOpenBrace`, `indexOfMatchingBrace`, `skipLexicalNoise` and `extendSpanWithLeadingJavadoc`. Write unit tests for: strings, char `'{'`, comments, text blocks, annotations with braces, generics, nested `record` / `enum` / `interface` / `@interface`, and the same simple name under different outer classes.
- [ ] **Candidates:** `fqnToSourceCandidates()` returns the exact `Outer$Inner.java` first, then the outer file. Connect it to the sources-JAR, inter-project and local-module readers.
- [ ] `get_class_source` returns only the nested type. Line numbers are relative to the file, and a one-line header names the enclosing file. The size guard applies to the slice.
- [ ] Provenance gets `nestedIn` and the `sourceRelativePath` of the outer file. Update SPEC §7.1 and §8.

**Done when:** `get_class_source …ImmutableList$Builder` succeeds from a sources JAR. Other paths work as before. Decompile without sources can still fail; checkpoint 5 fixes that.

## Checkpoint 5 — Nested classes: structure, decompile, search

- [ ] `parseJavaTypeMetadata(source, fqn)` accepts the nested path. `get_class_structure` and `get_method_signature` return the Javadoc and the real parameter names of the nested type.
- [ ] `find_in_class_source` and `methodNames` excerpts work on the nested slice.
- [ ] CFR fallback: decompile the **outer** class one time, cache it under `decompiled/`, then extract the nested type with the locator (`sourceAvailable: false`).
- [ ] `search_in_artifact`: skip `$` classes when their outer source was scanned.
- [ ] Anonymous and local classes (`Outer$1`): return a clear message that names the enclosing class.
- [ ] Evals: `s04` passes on the first call. Add 3–4 nested-class prompts to `test/evals/prompts.json`.

**Done when:** `ImmutableList$Builder` with `methodNames: ["build"]` succeeds with sources and without sources.

## Checkpoint 6 — Non-Java source lookup (Kotlin, Scala, Groovy)

**Problem:** the lookup expects `Foo.java`. Kotlin sources JARs contain `.kt` files, and the class name and the file name often differ (`FooKt`, many classes in one file). Today these classes go to CFR.

- [ ] **`SourceFile` attribute:** add a small class-file reader that gets the `SourceFile` attribute from the `.class`. The source path is the package directory plus `SourceFile`. This works for Kotlin facades, multi-class files, Scala and Groovy. It also works for non-public secondary top-level Java classes. Use it first, then the name-based candidates from checkpoint 4.
- [ ] Inter-project and local modules: read `src/{main,test}/{kotlin,scala,groovy}` in addition to `java`. The FQN index reads the `package` line, because in Kotlin the directory can differ from the package.
- [ ] Response: add `sourceLanguage` (`java` | `kotlin` | `scala` | `groovy`). `sourceAvailable: true` for original source. Update SPEC §7.1.
- [ ] Line-range excerpts and `find_in_class_source` work on all languages. For non-Java files, `methodNames` returns a clear message ("method excerpts are Java-only; use startLine/endLine") until checkpoint 7. `get_class_structure` uses `javap` for non-Java.
- [ ] Scenario `test/scenarios/gradle/kotlin-library/`: a Kotlin producer publishes a JAR and a sources JAR to a temp Maven repo, and a Java consumer uses it.
- [ ] Evals: add a Kotlin dependency to the eval project and 4 Kotlin prompts.

**Done when:** a class from a Kotlin library (including a `FooKt` facade) returns its `.kt` source with `sourceAvailable: true`.

## Checkpoint 7 — Kotlin declarations

**Goal:** Kotlin gets the same structure and excerpt quality as Java. Scala and Groovy stay at the checkpoint 6 level.

- [ ] `parseKotlinTypeMetadata`: `class` / `object` / `interface` / `fun` / `val` / `var`, KDoc, companion objects, top-level functions in facades, and extension functions.
- [ ] Map source members to JVM names: getters (`getX` / `isX`), `@JvmName`, `@JvmOverloads`, and default parameters. Then `get_method_signature` with a JVM name finds the Kotlin declaration.
- [ ] `methodNames` excerpts and `get_class_structure` (KDoc, parameter names) for `.kt`. Use the checkpoint 4 locator for nested Kotlin types.
- [ ] Unit tests on real kotlinx-coroutines and ktor source samples. Run the Kotlin eval prompts again.

**Done when:** `get_class_structure` and `methodNames` excerpts on a Kotlin library class show KDoc and real parameter names.

## Checkpoint 8 — Build-tool-neutral core

**Goal:** core code does not know Gradle. A new resolver is a new folder plus one line in the registry. **There is no behavior change.**

- [ ] Extend `DependencyResolver`: `id`, `rootMarkers`, `cacheInputs(projectRoot)`, `resolveSourcesJar(coordinates)`.
- [ ] Use neutral names in `ResolveOptions` / `ResolutionResult`: `inheritStderr`, `onBeforeResolve` / `onAfterResolve`, `subprocess` instead of `gradle`. Keep the old names as deprecated aliases in `public-api.ts` for one release.
- [ ] Remove Gradle imports from core files (`sources-jar-resolver.ts`, `get-class-source.ts`, `get-class-structure.ts`, `get-method-signatures.ts`, `search-in-artifact.ts`, `inherited-method-excerpt.ts`, `extractor/*`). Get `buildSystem` from `ResolutionOutput`; do not hard-code it.
- [ ] `project-path.ts` gets the root markers from the registry.
- [ ] Copy, progress labels and MCP instructions use the name of the resolver ("Resolving dependencies (Gradle)…" comes from the resolver).
- [ ] A test-only fake resolver runs `get`, `search_classes` and `search_in_artifact` end to end. This proves that the core is pluggable.

**Done when:** `grep -r "resolvers/gradle" src` finds only the registry and Gradle tests, and all tiers pass with no change.

## Checkpoint 9 — Maven: external dependencies

- [ ] **Spike first** and record the result here: a command that gives coordinates, scope and absolute JAR path for each reactor module **without writing under the project** (check for no `target/`). Candidates: `dependency:list -DoutputAbsoluteArtifactFilename=true -DoutputFile=<temp>`, or a small bundled extension or plugin. Check sibling modules that are not installed in a reactor.
- [ ] `MavenResolver`: detect `pom.xml`; use `./mvnw`, else `mvn`; remove JVM-injection env vars as for Gradle; use timeouts. Produce `ResolutionOutput` with configurations `compile`, `runtime` and `test`. If the schema changes, bump `schemaVersion`.
- [ ] Cache inputs: all `pom.xml` files in the reactor, `.mvn/maven.config`, `.mvn/extensions.xml`, `.mvn/wrapper/maven-wrapper.properties`.
- [ ] Sources: on-demand `dependency:get` / `dependency:copy` of the `sources` classifier into a temp or cache directory. Credentials and mirrors come from the user's `settings.xml`.
- [ ] JDK detection: read `maven.compiler.release` / `source` and the Maven version requirements.
- [ ] Scenarios in `test/scenarios/maven/`: `single-module`, `version-conflict` (Maven uses **nearest-wins**, not highest-wins), `local-install-snapshot`.
- [ ] README: Maven is **experimental**. MCP instructions say "Gradle and Maven projects".

**Done when:** `get`, `get_class_structure`, `search_classes` and `resolve_dependencies` work on a single-module Maven project, with sources and with CFR.

## Checkpoint 10 — Maven: reactor modules and polish

- [ ] Multi-module reactor: map sibling modules to `origin: interproject`. Read `src/main/java` (and the checkpoint 6 languages), and use `target/classes` for `javap`.
- [ ] Module paths: use the `artifactId` or a relative directory. Document the `modulePath` format for Maven in SPEC §5.4. File-path inference works.
- [ ] `local-file` / `system` scope JARs participate as in Gradle.
- [ ] Failure messages: get a Maven version of `gradle-failure-message.ts` (offline, auth, missing artifact).
- [ ] Scenario `maven/multi-module`. Add a Maven eval project and 6 prompts.
- [ ] README: remove "experimental" when the evals meet the checkpoint 3 targets.

**Done when:** the Maven eval prompts meet the same targets as Gradle.

## Checkpoint 11 — Gradle cache gaps

**Problem:** these changes need `forceRefresh` today: `buildSrc/src/**`, versions from `System.getenv()`, and included (composite) builds.

- [ ] **Spike:** measure a configuration-cache (CC) hit on the eval project and on a large build. Compare it with today's hash skip (no Gradle run).
- [ ] If the CC hit is ≤ 2 s: redesign `analyzer-init.gradle` with tasks per project that are made at configuration time, and run with `--configuration-cache`. Keep the hash only as a fast pre-check.
- [ ] Else: add `buildSrc/**`, `build-logic/**` and the build files of included builds to the digest. Write in SPEC §6.1 that env-based versions still need `forceRefresh`.
- [ ] Scenarios: a change in `buildSrc` and a change in an included build cause re-resolution without `forceRefresh`.

**Done when:** both scenarios pass, and the cost of a warm call does not increase by more than 2 s.

## Checkpoint 12 — Package and javadoc-JAR documentation

**Open questions. Get answers before you start:**

1. Which "docs-only" JARs are used: `-javadoc.jar` classifiers, internal Markdown or HTML artifacts, or other? Give a concrete example.
2. A new `get_package_docs` tool, or a package name as input to `get_class_structure`?

Steps:

- [ ] **Spike:** find docs-only artifacts and `package-info` / `package.html` on real projects. Check the Gradle API for javadoc artifacts (and Maven `javadoc` classifier). Get HTML samples from JDK 8, 11 and 17+. Decide the tool surface with 6 eval prompts and `measure:tokens`.
- [ ] Package Javadoc from `package-info.java` (sources JAR and inter-project).
- [ ] `jvmsrcResolveJavadoc` (and the Maven equivalent through the checkpoint 8 interface), a tolerant HTML-to-text extractor without new dependencies, and a `docs/` cache beside `decompiled/`.
- [ ] Class and member Javadoc when there are no sources: `get_class_structure` / `get_method_signature` fill it from the javadoc JAR. Add a `docsSource` field. `sourceAvailable` stays `false`.
- [ ] New codes `DOCS_NOT_FOUND` / `DOCS_RESOLVE_FAILED`: SPEC §7 and a release note. Treat HTML as untrusted: remove scripts and styles, use the size guard, and do not fetch from the network.
- [ ] Optional: a docs scope for `search_in_artifact`, or package summaries in the class-search index.

**Done when:** a package question on the eval project returns the description and a type list with one-line summaries, and the source of the text is labelled.

## Checkpoint 13 — Hierarchy tools

- [ ] Design an inverted index (supertype → subtypes / implementors) that shares the class-search index infrastructure and its invalidation.
- [ ] `get_implementors(interfaceName)` and `get_subclasses(className)`, with the same scoping as the other tools, direct and transitive results, grouped by artifact.
- [ ] Use the index build cost on a 300-JAR classpath to decide eager build or lazy build.
- [ ] Add 4 eval prompts. Make sure that eager tokens stay within the checkpoint 3 budget.

**Done when:** `get_implementors org.springframework.retry.RetryPolicy` on the eval project lists the implementations from the classpath.

## Checkpoint 14 — Exploration (optional, only spikes)

Do these only when users ask for them. Each item is a spike with a written result. When an item becomes real work, it becomes a new checkpoint.

- **sbt:** the `show Compile/fullClasspath` / `updateClassifiers` path; Scala source support is from checkpoint 6.
- **Bazel:** `bazel cquery` plus `rules_jvm_external`. Sources JARs are often missing.
- **Pluggable decompiler:** Vineflower can give better output for Kotlin and modern Java than CFR. This needs a `Decompiler` interface and a bundle size check.

---

## Rejected or parked decisions

| Decision | Reason |
|---|---|
| Make `modulePath` required | Agents do not know the module names before the first call. This lowers first-call success |
| Consolidate tools | Eval first-tool accuracy is 97%. There is no confusion between similar tools to fix |
| Answer the first module on a real version conflict | The agent could use the wrong version without notice. Keep `MODULE_AMBIGUOUS` |
| Bulk sources download in `jvmsrcResolve` | Slow. On-demand `jvmsrcResolveSources` is sufficient |
| Fallback scan of `~/.gradle` / `~/.m2` when resolution fails | Gives wrong versions. Return the error |
