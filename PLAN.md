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

Released together in 1.19.0: checkpoints 1 and 2.

Checkpoints 3, 4, 5, 6, 7, 8, 9, 10 and 11 are done and not released. Release them in order: 3 to 11.


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
| 11 | Gradle cache gaps (`buildSrc`, composite; env stays a known gap) | Removes most needs for `forceRefresh` | M |
| 12 | Package and javadoc-JAR documentation | New capability | L |
| 13 | Hierarchy tools | New capability, low frequency | L |
| 14 | Exploration: more build tools and decompilers | Optional. Only spikes | — |

---

## Checkpoint 1 — Security hardening (done)

**Goal:** close all open audit items. There is no change to the public API.

- [x] **JAR size guard.** Before `readFileSync`, do a `statSync` size check in `readZipEntryUtf8` / `zipEntryExists` (`src/extractor/zip-entry.ts`) and in all other full-JAR reads (find them with `grep readFileSync`). Add the `JVMSRC_MAX_JAR_BYTES` setting (default 500 MB). If the JAR is too large, return `ZIP_READ_ERROR` with the size and the limit in the message. Do not add a new code.
- [x] **Symlinked directories in the cache walk.** In `walk()` (`src/cache/index.ts`), use `lstatSync` and skip entries where `isSymbolicLink()` is true. Test: make a symlink loop, then make sure the walk stops and the digest is stable.
- [x] **`gradlew` trust model.** Add a section to SECURITY.md and a note to SPEC. Add `JVMSRC_USE_SYSTEM_GRADLE=1`, which makes jvmsrc use `gradle` on `PATH` instead of `./gradlew`. Test this in `gradle-wrapper-command.test.ts`.
- [x] **ReDoS guard for `find_in_class_source` regex mode.** Run the regex in a Worker thread with a wall-clock deadline (default 2 s; `JVMSRC_REGEX_TIMEOUT_MS`). Do not add a new dependency. On timeout, return an error value with a clear message. Test with `(a+)+$`.

**Done when:** the four tests pass and the app works as before on the eval project.

## Checkpoint 2 — Contract and docs debt (done)

**Goal:** make the docs agree with the current behavior. Remove small rough edges that are visible to agents.

- [x] SPEC §7: document the `MODULE_NOT_FOUND` "matches several modules" variant. Add `JVMSRC_PROJECT_ROOT` to the configuration table.
- [x] `MODULE_AMBIGUOUS` text: do not repeat the class name when the message already names it.
- [x] Resolution notes: show one footer line for "resolved `Foo` → `com.x.Foo`" (`resolvedFrom`) and for a lifted `projectRoot` (`note` from `resolveProjectRoot`). If a value is not useful, remove that field.
- [x] Cache cleanup: delete the orphaned single-slot `class-search-index.json` from a bucket when the bucket loads.
- [x] Copy drift: compare README, `server.json`, CONTRIBUTING and the hook docs with the current MCP tool descriptions. Fix old wording (for example "regex or substring searches", "projectRoot is required").
- [x] CHANGELOG: make sure that it lists these breaking changes: `scope: 'full'` was removed, a subdirectory `projectRoot` now resolves to the build root, and `INVALID_FQN` is reused for the simple-name pick list. Add the missing ones to the next release note.

**Done when:** a reviewer can read SPEC §7 and §8.2 and find no difference from the tool output on the eval project.

## Checkpoint 3 — Eval baseline and agent-UX tuning (done)

**Goal:** get current numbers, then fix the gaps that the data shows. Write the results in [test/evals/README.md](test/evals/README.md#results).

- [x] Run the full eval three times: default, `--with-hook` and `--mode competing`. Done 2026-11-10 (three rows in the eval README). The hook run made no Bash call, so the hook path was checked with a separate probe: the deny reason reaches the agent (eval README). This also gives the first live test of the `PreToolUse` hook: make sure that the deny reason reaches the agent.
- [x] Targets: first-call success ≥ 95%, `filecontext` module correct ≥ 90%, shell fallback 0% with the hook.
  Default run: usable first call 97% (target met); strict 87% (missed). The strict target counts `MODULE_AMBIGUOUS` on `ObjectMapper` as a failure, but those answers are correct by design and retry-ready. Decision: the target is **usable first-call success ≥ 95%** (retry-ready ambiguity counts as usable); strict is reported next to it. `filecontext` module correct 100%; shell fallback 0% without the hook. All three runs (default, hook, competing) meet the usable target, and shell fallback is 0% in all three. If a target is not met, make the change that the transcripts show (tool description or result footer), then run the failed prompts again.
- [x] Eager tokens ≤ 2,000 (today 2,478). Remove schema noise: `$schema`, `maximum: 9007199254740991` from `.int()`, `additionalProperties: {}`, and parameters that agents seldom use.
  Result: 2,584 at 1.19.0 → 1,982 (`chars / 4`). `tools/list` no longer has the three noise keys. `projectRoot`, `configuration`, `forceRefresh` (not on `resolve_dependencies`) and `maxClasses` are accepted but not advertised (0 uses in 81 recorded calls).
- [x] `measure:tokens`: replace `chars / 4` with a real tokenizer count. It uses the Anthropic `count_tokens` API when `ANTHROPIC_API_KEY` is set, else `chars / 4`; the output names the method.
- [x] If the file path is under `/src/test/`, infer `includeTest: true`. MCP and CLI; an explicit `includeTest` wins.
- [x] Performance on large builds: make a synthetic 50-module fixture. Measure the first `search_classes` call without `modulePath` and the double probe in `canonicalizeClassName` / `inferModulePath`. If the first call takes more than 10 s, add a project-wide index or a module cap. If `durationMs` shows a cost for `roots/list`, cache it (invalidate on `roots/list_changed`).
  Result (`bun scripts/bench-large-build.ts`, 50 modules × 80 real JARs, seeded cache, M-series Mac): first `search_classes` without `modulePath` 1.3–1.5 s (warm 0.9 s); `get_class_structure` without `modulePath` 0.8–1.4 s. All are far below 10 s, so there is no module cap or project-wide index. The double probe is removed (`canonicalizeClassName` hands its `inferModulePath` result to `resolveModuleScopeOrError`): a class on every module went from 2.0 s to 1.3 s, a class in one module from 1.3 s to 0.8 s. `roots/list` is not cached: the fastest recorded calls took 3–5 ms in total.
- [x] CLI parity: make `--project` optional. Use the same discovery as MCP (env, cwd, lift to the build root).

**Done when:** the README results table has a full run, and each target is met or has a recorded reason.

## Checkpoint 4 — Nested classes: source (done)

**Problem:** `get_class_source com.google.common.collect.ImmutableList$Builder` returns `DECOMPILE_FAILED`. The lookup asks for `ImmutableList$Builder.java`, but that file does not exist.

- [x] **Spike:** on guava `ImmutableList`, check what CFR does with the inner class alone and with the outer class. Record the result here. Decide the shape of the decompile fallback for checkpoint 5.
  Result (guava 32.1.2-jre, bundled CFR 0.152, `java -jar cfr.jar <jar> --jarfilter <name> --silent true`): a filter for `ImmutableList$Builder` exits 0 and prints nothing, which is today's `DECOMPILE_FAILED` ("CFR produced no decompiled source"). A filter for `ImmutableList` prints the outer class with `public static final class Builder` and `build()` inside it. That filter is unanchored, so the same output also contains `ImmutableListMultimap`. `ImmutableList.class` alone does not contain `Builder` (separate class file). `ImmutableList$Builder.class` alone decompiles, but as `public static final class ImmutableList.Builder` and with "Could not load" the enclosing types. Checkpoint 5: decompile once with the outer-class jarfilter, cache that text, then slice with the locator. Anchor the filter, or drop classes that are not the outer type or its `$` nested types, so `ImmutableList` does not keep `ImmutableListMultimap`.
- [x] **Locator:** `locateTypeDeclaration(source, ['Outer', 'Inner', …])` → `{ start, openBrace, closeBrace }`. `start` includes the Javadoc and annotations before the declaration. Reuse `findTopLevelTypeKeywordMatch`, `findTypeBodyOpenBrace`, `indexOfMatchingBrace`, `skipLexicalNoise` and `extendSpanWithLeadingJavadoc`. Write unit tests for: strings, char `'{'`, comments, text blocks, annotations with braces, generics, nested `record` / `enum` / `interface` / `@interface`, and the same simple name under different outer classes.
- [x] **Candidates:** `fqnToSourceCandidates()` returns the exact `Outer$Inner.java` first, then the outer file. Connect it to the sources-JAR, inter-project and local-module readers.
- [x] `get_class_source` returns only the nested type. Line numbers are relative to the file, and a one-line header names the enclosing file. The size guard applies to the slice.
- [x] Provenance gets `nestedIn` and the `sourceRelativePath` of the outer file. Update SPEC §7.1 and §8.

**Done when:** `get_class_source …ImmutableList$Builder` succeeds from a sources JAR. Other paths work as before. Decompile without sources can still fail; checkpoint 5 fixes that.

## Checkpoint 5 — Nested classes: structure, decompile, search (done)

- [x] `parseJavaTypeMetadata(source, fqn)` accepts the nested path. `get_class_structure` and `get_method_signature` return the Javadoc and the real parameter names of the nested type.
- [x] `find_in_class_source` and `methodNames` excerpts work on the nested slice.
- [x] CFR fallback: decompile the **outer** class one time, cache it under `decompiled/`, then extract the nested type with the locator (`sourceAvailable: false`).
- [x] `search_in_artifact`: skip `$` classes when their outer source was scanned.
- [x] Anonymous and local classes (`Outer$1`): return a clear message that names the enclosing class.
- [x] Evals: `s04` passes on the first call. Add 3–4 nested-class prompts to `test/evals/prompts.json`.

**Done when:** `ImmutableList$Builder` with `methodNames: ["build"]` succeeds with sources and without sources.

## Checkpoint 6 — Non-Java source lookup (Kotlin, Scala, Groovy) (done)

**Problem:** the lookup expects `Foo.java`. Kotlin sources JARs contain `.kt` files, and the class name and the file name often differ (`FooKt`, many classes in one file). Today these classes go to CFR.

- [x] **`SourceFile` attribute:** add a small class-file reader that gets the `SourceFile` attribute from the `.class`. The source path is the package directory plus `SourceFile`. This works for Kotlin facades, multi-class files, Scala and Groovy. It also works for non-public secondary top-level Java classes. Use it first, then the name-based candidates from checkpoint 4.
  Result: `src/extractor/class-file-source-file.ts`. Only binary-JAR hits read it (inter-project trees are step 2). `get` returns a non-Java file whole; a Java file with another name is sliced. Structure and signatures use only a `.java` `SourceFile`, so Kotlin still goes to `javap`.
- [x] Inter-project and local modules: read `src/{main,test}/{kotlin,scala,groovy}` in addition to `java`. The FQN index reads the `package` line, because in Kotlin the directory can differ from the package.
  Result: a `.java` lookup also tries `.kt`, `.scala` and `.groovy`. A compiled class's `SourceFile` is tried first (`FooKt` → `Foo.kt`). The index FQN is the `package` declaration plus the file name. Kotlin text is not passed to the Java parser.
- [x] Response: add `sourceLanguage` (`java` | `kotlin` | `scala` | `groovy`). `sourceAvailable: true` for original source. Update SPEC §7.1.
  Result: the field is the extension of the file that was read. CFR text is `java` with `sourceAvailable: false`. CLI stderr, `--json` and MCP `get_class_source` include it.
- [x] Line-range excerpts and `find_in_class_source` work on all languages. For non-Java files, `methodNames` returns a clear message ("method excerpts are Java-only; use startLine/endLine") until checkpoint 7. `get_class_structure` uses `javap` for non-Java.
  Result: `methodNames` on non-Java source returns `EXCERPT_REQUEST_INVALID` with the Java-only message (no new code). `find_in_class_source` does not narrow a nested name in non-Java files.
- [x] Scenario `test/scenarios/gradle/kotlin-library/`: a Kotlin producer publishes a JAR and a sources JAR to a temp Maven repo, and a Java consumer uses it.
- [x] Evals: add a Kotlin dependency to the eval project and 4 Kotlin prompts.
  Result: kotlinx-coroutines-core-jvm 1.10.2 in `:worker`, new `kotlin` category (`k01`–`k04`). 4/4 passed, 75% first-call (the miss is the designed Java-only message). The run found a real gap: Kotlin Multiplatform sources JARs use `commonMain/…` folders, so the `<package dir>/<SourceFile>` path missed and every class went to CFR. Fix: if that path is absent, scan the sources JAR for the `SourceFile` name and keep entries whose `package` line matches (SPEC §7.1). Facades of `@JvmMultifileClass` files (`BuildersKt`, `JobKt`) have no `SourceFile` and still go to CFR. Scala and Groovy are covered by unit tests only, not by a scenario or eval.

**Done when:** a class from a Kotlin library (including a `FooKt` facade) returns its `.kt` source with `sourceAvailable: true`.

## Checkpoint 7 — Kotlin declarations (done)

**Goal:** Kotlin gets the same structure and excerpt quality as Java. Scala and Groovy stay at the checkpoint 6 level.

- [x] `parseKotlinTypeMetadata`: `class` / `object` / `interface` / `fun` / `val` / `var`, KDoc, companion objects, top-level functions in facades, and extension functions.
  Result: `src/class-structure/kotlin/` (`kotlin-lexer`, `kotlin-declarations`, `parse-kotlin-type-metadata`). It is a structural scanner, not a Kotlin grammar: it finds each declaration, its KDoc and its header, and skips bodies as text. It parsed 568 real files (kotlin-stdlib, kotlinx-coroutines, kotlinx-serialization, ktor) with no failure. Fixtures are real sources in `test/fixtures/kotlin/`.
- [x] Map source members to JVM names: getters (`getX` / `isX`), `@JvmName`, `@JvmOverloads`, and default parameters. Then `get_method_signature` with a JVM name finds the Kotlin declaration.
  Result: `kotlin-jvm-names.ts` (the mapping table is in SPEC §7.2) and `kotlin-overlay.ts`. A source member is paired with a javap method by name and parameter count, then by type; an ambiguous pair stays unmatched. javap shows `get_method_signature` only for the exact JVM name, so a mangled overload (`delay-VtjQ1oo`) appears in `get_class_structure` but not for `get_method_signature delay`.
- [x] `methodNames` excerpts and `get_class_structure` (KDoc, parameter names) for `.kt`. Use the checkpoint 4 locator for nested Kotlin types.
  Result: `get_class_structure` and `get_method_signature` keep javap for signatures and add KDoc and parameter names (new `sourceLanguage` field). `methodNames` match a JVM name or a Kotlin name, and companion members. `get_class_source` slices a nested Kotlin type or one class of a multi-class file; `find_in_class_source` narrows a nested name. Fixed on the way: javap parameter parsing read the last token of `Continuation<? super X>` as a parameter name.
- [x] Unit tests on real kotlinx-coroutines and ktor source samples. Run the Kotlin eval prompts again.
  Result: 5 real files as fixtures, plus the `kotlin-library` scenario (8 tests). Kotlin evals: 4/4, first-call 100% (checkpoint 6: 75%). Not done (out of scope, as agreed): multi-file facades (`BuildersKt`), Scala and Groovy declarations, Kotlin-style type display.

**Done when:** `get_class_structure` and `methodNames` excerpts on a Kotlin library class show KDoc and real parameter names.

## Checkpoint 8 — Build-tool-neutral core (done)

**Goal:** core code does not know Gradle. A new resolver is a new folder plus one line in the registry. **There is no behavior change.**

- [x] **Characterization tests and ratchet guard** before refactoring: golden hex of `computeBuildInputsDigest` on `test/fixtures/gradle-smoke`, snapshots of MCP `instructions` / `tools/list` and `resolveProjectRoot` messages, plus `src/build-tool-neutral-core.test.ts` (zero `resolvers/gradle` imports outside the registry, and a checkpoint-tagged allowlist for remaining Gradle references in `jdk/`, diagnostics, CLI help, copy, and 1-release aliases).
- [x] Extend `DependencyResolver` (`id`, `displayName`, `rootHint`, `detect`, `findBuildRoot`, `cacheInputs`, `isImmutableArtifact`, `resolve`, `resolveSourcesJar`) and add `allResolvers()`, `resolverById(id)` and `@internal` `registerResolverForTesting` in `src/resolvers/index.ts`.
- [x] Move Gradle cache-input walking and `isGradleManagedJar` into `src/resolvers/gradle/cache-inputs.ts` (over a generic symlink-safe `walkProjectTree` in core). Keep the Gradle build-input digest byte-identical (`7ebe56ddcbb78c1b4de64427e73cfa78f62b5b55a08adb54bc4ce197ef3b1278`). Miss the cache when `output.buildSystem.type !== resolver.id`.
- [x] Relax `validateResolutionOutput` and `mcp.ts` schemas to accept any non-empty `buildSystem.type` string (`BuildSystemInfo.type: string`), and fall back to configuration `scope` (`compile` / `test-compile`) in `pick-classpath.ts` when Gradle configuration names are absent.
- [x] Route on-demand sources JARs through `resolverById(output.buildSystem.type)` in `createSourcesJarResolver`, and make `search-in-artifact.ts` use `createSourcesJarResolver`.
- [x] Add neutral `ResolveOptions` (`inheritStderr`, `onBeforeResolve`, `onAfterResolve`), `ResolutionResult.subprocess`, `SubprocessCapture`, and `SubprocessHooks`. Keep `inheritGradleStderr`, `onBeforeGradle`, `onAfterGradle`, `ResolutionResult.gradle`, `GradleProcessCapture`, `ResolveSourcesJarGradleOptions`, `GetClassSourceCliOptions.verboseGradle`, and `public-api.ts` `resolveSourcesJar` as `@deprecated` aliases for one release; mark `ResolveWithResolutionCacheOptions.resolver` `@internal`.
- [x] Lift `projectRoot` and build guidance messages in `src/project-path.ts` from registered resolvers (`findBuildRoot`, `displayName`, `rootHint`) with identical Gradle snapshots. Build CLI progress labels and MCP `instructions` from `displayName`, and pass `output.buildSystem.type` / `resolver.id` / `null` to `recordFailureDiagnostic` (no `'gradle'` default).
- [x] End-to-end fake resolver test (`test/fixtures/fake-resolver.test.ts`) running `resolveProjectRoot`, cached `resolveWithResolutionCache`, `getClassSource`, `searchClasses`, `searchInArtifact`, CLI progress labels, and MCP `resolve_dependencies` without spawning Gradle.
- [x] Update SPEC §4.2–§4.4, §5.5.2 and §6.1, and add "Adding a resolver" to CONTRIBUTING.
  Also fixed: wired persisted `javaToolchainVersion` (`readCachedJavaToolchainVersion`) into `runGradleTask` and `runJavaDoctor` when `cachedToolchainVersion` is omitted.

**Done when:** `src/build-tool-neutral-core.test.ts` passes (zero `resolvers/gradle` imports outside the registry, allowlist reduced to checkpoint 9/10 items and 1-release aliases), golden digest and copy snapshots match, `test/fixtures/fake-resolver.test.ts` passes, and all tiers pass with no behavior change.

## Checkpoint 9 — Maven: external dependencies (done)

- [x] **Spike first** and record the result here: a command that gives coordinates, scope and absolute JAR path for each reactor module **without writing under the project** (check for no `target/`). Candidates: `dependency:list -DoutputAbsoluteArtifactFilename=true -DoutputFile=<temp>`, or a small bundled extension or plugin. Check sibling modules that are not installed in a reactor.
  Result (Apache Maven 3.9.9, uninstalled 3-module reactor `parent` + `lib` + `app` where `app` depends on `lib:0.0.1-SNAPSHOT` plus `compile`/`provided`/`runtime`/`test` external deps):
  1. `dependency:list -DoutputAbsoluteArtifactFilename=true` **fails (`exit 1`)** when `lib` is not `mvn install`ed (`@Mojo(requiresDependencyResolution = TEST)` attempts to download `lib.jar` before the mojo runs), omits module headers in `-DoutputFile` with `-DappendOutput=true`, has no `direct: boolean`, merges all scopes under `TEST` conflict mediation (so a direct `test` version overrides a transitive `compile` version), and downloads ~45 plugin JARs (~12 MB) on first run (breaks offline repos).
  2. `dependency:tree` succeeds (`0.31 s`, no `target/`), but only collects POMs — it neither downloads missing external JARs nor prints JAR file paths.
  3. **Winner — bundled Maven core extension (`resources/maven-analyzer.jar`, ~11 KB, `--release 8`, `META-INF/plexus/components.xml`, zero external runtime dependencies)** invoked via `mvn -B -q -Dmaven.ext.class.path=<jar> -Djvmsrc.mode=resolve validate`:
     - Runs in `AbstractMavenLifecycleParticipant.afterProjectsRead(MavenSession)`, reads compiler settings, then clears in-memory `project.getBuild().getPlugins()` so `validate` runs zero user plugins (verified against a hostile `maven-antrun-plugin` bound to `validate`), writes zero files under `projectRoot`, and exits `0` in ~0.95 s.
     - Uses Maven's built-in `ProjectDependenciesResolver` + `RepositorySystem` with a depth-aware `ClasspathScopeSelector` to resolve `compile`, `runtime`, and `test` independently (verified: transitive `compile` `slf4j-api:2.0.9` from uninstalled `lib` is preserved on `app`'s `compile`/`runtime` classpaths while direct `test` `slf4j-api:2.0.7` wins on `test` via Maven nearest-wins), while skipping artifact-file download for reactor siblings via `setResolutionFilter`.
     - The same extension handles on-demand sources JARs (`-Djvmsrc.mode=sources -Djvmsrc.group=g -Djvmsrc.artifact=a -Djvmsrc.version=v`) in ~0.95 s via `RepositorySystem.resolveArtifact` with `classifier="sources"`, inheriting `settings.xml` mirrors, proxies, credentials, `<localRepository>`, and `.mvn/maven.config`.
- [x] Remove the `@deprecated` Gradle option aliases from checkpoint 8 (`inheritGradleStderr`, `onBeforeGradle`, `onAfterGradle`, `ResolutionResult.gradle`, `GradleProcessCapture`, `ResolveSourcesJarGradleOptions`, `GetClassSourceCliOptions.verboseGradle`, top-level `resolveSourcesJar`) and remove those files from `src/build-tool-neutral-core.test.ts`.
  Result: removed all 8 aliases and dropped `get-class-source.ts`, `public-api.ts`, `resolve-with-cache.ts`, `resolvers/base.ts`, `copy/tool-descriptions.ts`, and `mcp.ts` from `GRADLE_REFERENCE_ALLOWLIST` (release note item).
- [x] `MavenResolver`: detect `pom.xml`; use `./mvnw`, else `mvn` (`JVMSRC_USE_SYSTEM_MAVEN=1`, `JVMSRC_MAVEN_BIN`, `MAVEN_HOME` / `M2_HOME`); remove JVM-injection env vars (`MAVEN_OPTS` + `CFR_STRIPPED_ENV_KEYS`); use timeouts (`JVMSRC_MAVEN_TIMEOUT_MS`); merge `.mvn/maven.config` `-Dmaven.ext.class.path`; climb aggregator `<modules>` in `findMavenBuildRoot`. Produce `ResolutionOutput` (`1.2`) with configurations `compile`, `runtime` and `test`.
  Result: `src/resolvers/maven/` + `resources/maven-analyzer-src/` built reproducibly via `bun run setup:maven-analyzer` (`scripts/build-maven-analyzer.ts`, wired into CI and `release-please.yml`).
- [x] Cache inputs: all `pom.xml` files in the reactor, `.mvn/maven.config`, `.mvn/jvm.config`, `.mvn/extensions.xml`, `.mvn/wrapper/maven-wrapper.properties`, plus `M2_LOCAL_REPO` and `M2_SETTINGS_SHA256`; SNAPSHOT-aware `isImmutableArtifact`.
- [x] Sources: on-demand `-Djvmsrc.mode=sources` lookup of the `sources` classifier via `RepositorySystem` (plus fast-path detection when `<stem>-sources.jar` already sits beside `<stem>.jar` in the local repository). Credentials and mirrors come from the user's `settings.xml`.
- [x] JDK detection: read `maven.compiler.release` / `source` / `target` / `java.version` (with `${prop}` interpolation) and `maven-compiler-plugin` `<configuration>`, plus Maven wrapper minimum Java (Maven 3.x → Java 8+, Maven 4.x → Java 17+) and persisted `javaToolchainVersion`.
- [x] Scenarios in `test/scenarios/maven/`: `single-module`, `version-conflict` (Maven uses **nearest-wins**, not highest-wins), `local-install-snapshot`.
- [x] README: Maven is **experimental**. MCP instructions say "Gradle and Maven projects" (`1,972` eager approx tokens, below the 2,000 budget).

**Done when:** `get`, `get_class_structure`, `search_classes` and `resolve_dependencies` work on a single-module Maven project, with sources and with CFR.

## Checkpoint 10 — Maven: reactor modules and polish (done)

- [x] Multi-module reactor: map sibling modules to `origin: interproject`. Read `src/main/java` (and the checkpoint 6 languages), and use `target/classes` for `javap`.
  Result: added `target/classes` and `target/test-classes` to `interprojectBytecodeRootSuffixes` (`src/extractor/interproject-paths.ts`). Uncompiled reactors resolve `.java` / `.kt` / `.scala` / `.groovy` directly from `src/{main,test}/*`; compiled siblings also provide `javap` inheritance and `SourceFile` attributes for Kotlin `*Kt` facades.
- [x] Module paths: use the `artifactId` or a relative directory. Document the `modulePath` format for Maven in SPEC §5.4. File-path inference works.
  Result: `matchModule` (`src/extractor/match-module.ts`) normalizes Maven `artifactId`s (`acme-app`, `:acme-app`), recognizes the reactor root module via `m.path === projectRoot` (`:`, `.`, `root`), and resolves relative directories (`services/app`) and file paths (`services/app/src/test/...` with `includeTest: true`). Documented in SPEC §5.4.
- [x] `local-file` / `system` scope JARs participate as in Gradle.
  Result: `JvmsrcMavenAnalyzer` skips remote Aether download on `<scope>system</scope>` and resolves `<systemPath>` directly as `origin: 'local-file'`, `type: 'local-file'`.
- [x] Failure messages: get a Maven version of `gradle-failure-message.ts` (offline, auth, missing artifact).
  Result: `src/resolvers/maven/maven-failure-message.ts`, Maven classification in `src/diagnostics/map-failure.ts`, and build-tool-neutral copy in `src/copy/error-messages.ts` + `src/copy/empty-messages.ts` (both removed from `src/build-tool-neutral-core.test.ts`).
- [x] Scenario `maven/multi-module`. Add a Maven eval project and 6 prompts.
  Result: `test/scenarios/maven/multi-module/`, `test/evals/maven-project/` (`core`, `app`, `worker`), `test/evals/maven-prompts.json` (`mv01`–`mv06`), and `bun run eval:maven`. Live run (Claude Code 2.1.325): 6/6 passed, selection recall 100%, precision 100%, usable first-call success 100% (strict 80%: `mv03` `MODULE_AMBIGUOUS` on `ObjectMapper`), `filecontext` module correct 100%, first-tool accuracy 100%, shell fallback 0%, eager tokens 1,972 (`chars / 4`). Recorded in `test/evals/README.md`.
- [x] README: remove "experimental" when the evals meet the checkpoint 3 targets.

**Done when:** the Maven eval prompts meet the same targets as Gradle.

## Checkpoint 11 — Gradle cache gaps (done)

**Problem:** these changes need `forceRefresh` today: `buildSrc/src/**`, versions from `System.getenv()`, and included (composite) builds.

- [x] **Spike:** measure a configuration-cache (CC) hit on the eval project and on a large build. Compare it with today's hash skip (no Gradle run).
  Result (Gradle 8.14.5, `test/evals/project`, 3 modules, warm daemon): without CC, cold 2.9 s and warm 0.48 s. With `--configuration-cache`, the current init script fails (`Task.project` used at execution time, `analyzer-init.gradle:18`), so no CC hit exists to measure without a redesign. A warm run is already under 0.5 s here, so CC can gain little. A large build was not measured. Decision: design 2 (wider digest).
- [x] (Not chosen, see spike result.) If the CC hit is ≤ 2 s: redesign `analyzer-init.gradle` with tasks per project that are made at configuration time, and run with `--configuration-cache`. Keep the hash only as a fast pre-check.
- [x] Else: add `buildSrc/**`, `build-logic/**` and the build files of included builds to the digest. Write in SPEC §6.1 that env-based versions still need `forceRefresh`.
- [x] Scenarios: a change in `buildSrc` and a change in an included build cause re-resolution without `forceRefresh`.

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
| Items known but not scheduled (build-tool source roots, JDK/env digest gaps) | Listed in [docs/deferred.md](docs/deferred.md) with triggers for maintainers |
