# JVM Source Lens — technical specification

Authoritative reference for **`jvmsrc`** behavior, schemas, and contracts. For installation and everyday use, see [README.md](README.md). Implementation status: [ROADMAP.md](ROADMAP.md).

If you work on a Java-style codebase (Java, Kotlin, Scala, Groovy) with agents or automation, agents often need the truth about a dependency: what version is *actually* on the classpath, what does a class look like, and can you read real source or only bytecode? **JVM Source Lens** answers that by **asking Gradle** for the resolved graph, then opening the right jar or subproject. Nothing gets written into your project for resolution — the tool injects an init script from the package instead of touching your tree. When there is no sources jar, the bundled CFR build still gives you readable Java.

**What this repo covers:** Gradle first, offline-friendly packaging (`npm` / `npx`), resolution output you can cache, and class lookup (source preferred, decompile as backup). Maven, Bazel, and other resolvers are sketched in the architecture but not required for the first shipping path.

**Why not just read `~/.gradle`?** Those folders hold lots of versions across lots of projects. Picking a jar by path or name alone is guesswork. The rule here is: **if it matters, ask the build tool**, then read files from the answer it gives you.

---

## 1. Problem Statement

LLM agents working on JVM codebases (Java, Kotlin, Scala, Groovy) frequently lack visibility into external library internals. Without access to actual class signatures, method contracts, and field definitions, agents hallucinate API shapes — producing code that compiles against an incorrect mental model of a dependency.

The core challenge has three parts:

1. Finding **which version** of a library the project actually uses — not what happens to be in the global machine cache.
2. **Extracting the correct class** — returning original source if available, decompiled bytecode otherwise.
3. Doing this **without modifying the project**, invoking unnecessary build steps, or requiring IDE integration.

### The Key Insight

There is **no reliable way to match a project to its artifacts without performing build-tool-specific dependency resolution.** Global caches (`~/.gradle/caches`, `~/.m2/repository`) may contain multiple versions of the same library. Picking the wrong version silently produces incorrect output — which is worse than an outright error.

The JVM ecosystem stores artifacts globally on the machine rather than inside the project. A project using `lib:1.0` and a project using `lib:3.0` share the same cache directory. Without asking the build tool, there is no deterministic way to know which version belongs to which project — especially in multimodule builds where different submodules may use different versions of transitive dependencies.

This tool solves the version disambiguation problem by delegating to the authoritative source: **the build tool itself**.

---

## 2. Existing Landscape

Several tools address adjacent problems but none fully solve this one:

| Tool | Approach | Gap |
|---|---|---|
| `java-class-analyzer-mcp-server` | TypeScript MCP, bundled CFR, class indexing | Maven-only; reads `~/.m2` directly, no build tool invocation |
| `maven-indexer-mcp` | Indexes Maven + Gradle cache directories | Scans cache blindly; no per-project version resolution |
| `jarp-mcp` | TypeScript MCP, parses `build.gradle` statically | Static parsing misses transitive deps, BOMs, dynamic versions |
| `gradle-mcp-server` | Uses Gradle Tooling API | Focused on task execution, not class-level source extraction |
| `mcp-javadc` | JS port of CFR, no Java required | Operates on explicit file paths only; no dependency resolution |

The gap all of them share: **none invoke the build tool to get the actual resolved dependency graph.** This tool does.

---

## 3. Requirements

### 3.1 Functional

- Given a fully-qualified class name (e.g., `com.example.MyClass`), return its Java source code.
- Optionally return **structured class metadata** (signatures, hierarchy, Javadoc when sources exist) without full source via MCP `get_class_structure` (§8.2) to reduce context use and latency.
- Resolve the correct artifact version by querying the project's actual build tool — never by guessing from cache.
- Support multimodule projects; resolve dependencies **per submodule** when a module path is specified.
- Prefer original **source JARs** over decompilation when available.
- **Decompile bytecode automatically** (via bundled CFR) when no source JAR is available.
- Recognize **inter-project dependencies** in multimodule builds and return source file paths rather than decompiling own-project classes.
- Support Gradle projects at launch; be architected to add Maven, Bazel, and other resolvers without modifying core logic.
- Reject unsupported project types with a clear, actionable error message.

### 3.2 Non-Functional

- **Zero project modification:** no files written to the target project directory.
- **Low latency for sequential calls:** build-tool resolution runs once per session; results are cached until build files change (hash-based invalidation), with an explicit **force refresh** escape hatch when artifacts change without build-file edits (§6.1).
- **Frictionless installation:** single command via `npm install -g` or `npx`.
- **Dual interface:** usable as both a CLI shell command and an MCP server from the same package.
- **Offline-capable:** all auxiliary tools (CFR decompiler, Gradle init script) bundled in the NPM package; no runtime downloads.
- **Never silently resolve ambiguity:** if version cannot be determined deterministically, surface the conflict to the caller rather than guessing.

---

## 4. Architecture

### 4.1 Layered Design

The system is divided into four independent layers. Each layer communicates only with the layer below via a stable interface, making any layer replaceable without affecting the others.

```
┌─────────────────────────────────────────────────────────┐
│                     Interface Layer                      │
│           CLI entry point  +  MCP Server                │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  Resolver Registry                       │
│    Detects build system → delegates to correct plugin    │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│               Resolver Plugins (extensible)              │
│    GradleResolver │ MavenResolver* │ BazelResolver*      │
│                        * future                         │
└───────────────────────┬─────────────────────────────────┘
                        │  ResolutionOutput
┌───────────────────────▼─────────────────────────────────┐
│            Extractor + Decompiler Layer                  │
│   JAR lookup → source JAR preference → CFR fallback     │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Core Interfaces (TypeScript)

All resolver plugins implement the following contract. Resolution produces a **`ResolutionOutput`** document (stdout from Gradle today, and the same object persisted in the global resolution cache — see **§6.1** / §5.5.2). The extractor chooses one `ResolvedConfiguration` per call using `ResolveOptions` (`configuration`, `includeTest`, `modulePath`); it does not re-invoke Gradle.

Gradle failures, parse errors, or unsupported `schemaVersion` are returned as **`ResolutionResult` errors** (`ok: false`) rather than thrown, so callers can surface actionable messages. Unexpected bugs and process spawn failures follow the same `ok: false` path for Gradle exits; only corrupted installation (e.g. missing bundled init script) may throw from resource helpers.

```typescript
interface DependencyResolver {
  detect(projectRoot: string): boolean;
  resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolutionResult>;
}

type ResolutionResult =
  | { ok: true; output: ResolutionOutput }
  | { ok: false; message: string; stderr?: string };

interface ResolveOptions {
  modulePath?:    string;   // e.g. ':core:utils' — scope class lookup to one submodule
  configuration?: string;   // e.g. 'compileClasspath' — which resolved configuration to read
  includeTest?:   boolean;  // when defaulting configuration, include test classpaths (default: false)
}

// Full JSON shape: schemaVersion, resolvedAt, buildSystem, projectRoot, modules[], errors[]
// and nested ResolvedModule / ResolvedConfiguration / ResolvedArtifact — see §5.5.2.
```

The exhaustive TypeScript definitions in this repo live in `src/resolvers/resolution-output.ts` and match §5.5.2.

### 4.3 Resolver Registry

The registry is the single extension point. Adding a new build system requires: (1) creating a folder under `src/resolvers/`, (2) implementing `DependencyResolver`, (3) adding one line to the registry array. Nothing else in the codebase changes.

```typescript
// src/resolvers/index.ts
const RESOLVERS: DependencyResolver[] = [
  new GradleResolver(),
  // new MavenResolver(),   ← future: one line to enable
  // new BazelResolver(),
];

export function detectResolver(projectRoot: string): DependencyResolver {
  const resolver = RESOLVERS.find(r => r.detect(projectRoot));
  if (!resolver) {
    throw new UnsupportedProjectError(
      `No supported build system found in ${projectRoot}. ` +
      `Currently supported: Gradle. Contributions welcome.`
    );
  }
  return resolver;
}
```

### 4.4 Repository Structure

```
resources/
  cfr.jar                 ← bundled CFR (also validated in prepack)
  analyzer-init.gradle    ← bundled Gradle init script (--init-script path)
src/
  resolvers/
    index.ts              ← registry + detectResolver()
    base.ts               ← DependencyResolver + ResolutionResult types
    resolution-output.ts  ← ResolutionOutput + JSON validators
    gradle/
      index.ts            ← GradleResolver (Bun.spawn → Gradle)
    maven/                ← future
      index.ts
  bundled-resources.ts    ← getBundledResource(), package-root resolution
  extractor/
    class-source-types.ts   ← lookup options + ClassSourceLookupResult / errors
    find-external-class-jar.ts ← first external JAR owning a .class (shared with get / signatures)
    fqn-paths.ts            ← FQN → ZIP entry paths
    pick-classpath.ts       ← ResolvedModule + configuration selection
    zip-entry.ts            ← single-entry ZIP reads (fflate)
    extract-external-class-source.ts
    index.ts                ← re-exports
  class-structure/
    types.ts                ← javap overload structs + classpathJar provenance
    javap-parse.ts          ← parse javap -verbose output
    spawn-javap.ts          ← javap subprocess (JDK next to java)
  get-class-source.ts       ← resolveWithResolutionCache + extract
  get-method-signatures.ts       ← resolve + source-first + javap overload listing
  get-method-signatures-bytecode.ts  ← javap-only overload listing (no source fallback)
  method-signature-from-javap.ts ← shared javap parse helper for method overloads
  public-api.ts             ← library entry (`package.json` `main` / `exports`)
  cli-get-output.ts         ← `get` stdout/stderr JSON formatting
  cli-progress.ts           ← phased stderr progress (CLI)
  diagnostics/            ← structured failure logs (`recordFailureDiagnostic`, rolling NDJSON, `jvmsrc diagnostics`; §6.3)
  decompiler/
    decompile-external-class.ts  ← cache + CFR orchestration
    spawn-cfr.ts                 ← `java -jar cfr.jar` subprocess
    index.ts                     ← re-exports
  cache/
    paths.ts              ← global cache root (env-paths) + project bucket paths
    decompiled-paths.ts   ← global `decompiled/<g>/<a>/<v>/<Class>.java` paths
    index.ts              ← build-input digest, read/write resolution cache files
  resolve-with-cache.ts   ← resolveWithResolutionCache() — cache gate + resolver on miss
  cli.ts                  ← CLI entry point (`get`, `resolve`, `mcp`, …)
  mcp.ts                  ← MCP server entry point
```

---

## 5. Gradle Resolver (v1 Implementation)

### 5.1 Detection

`GradleResolver.detect()` checks for the presence of any of the following in the project root:

- `build.gradle` or `build.gradle.kts`
- `settings.gradle` or `settings.gradle.kts`

### 5.2 Resolution Mechanism

Resolution is performed by injecting the bundled [`resources/analyzer-init.gradle`](resources/analyzer-init.gradle) with Gradle’s `--init-script` flag. Only the **absolute path** to that file is external; nothing is written under the target project’s tree for resolution itself.

The Node implementation prefers **`./gradlew`** when present (correct Gradle version for the repo), otherwise **`gradle`** on `PATH`. It passes **`-PjvmsrcWrapper=true|false`** so the emitted JSON records whether the wrapper was used (`buildSystem.wrapper`).

**Configuration cache:** v1 always passes **`--no-configuration-cache`**. The bundled task resolves every submodule in one root task that walks `allprojects` at execution time; that pattern is incompatible with Gradle’s configuration cache until a future redesign (e.g. per-project tasks). Real-world projects with configuration cache enabled in `gradle.properties` still work because this flag disables CC for this invocation only.

**Wall-clock limits:** Each Gradle subprocess for **`jvmsrcResolve`** (resolution cache refresh) and **`jvmsrcResolveSources`** (on-demand sources JAR) is capped by a timeout (default **600000** ms = **10** minutes). Override with **`JVMSRC_GRADLE_TIMEOUT_MS`** (positive integer, milliseconds). On timeout the child is killed; callers see the usual structured failure path with a message containing **`timed out`** (MCP treats this as retryable where applicable).

**End-to-end latency:** After a cold **`get`**, expect up to **two** Gradle runs when sources must be fetched: one for **`jvmsrcResolve`** (if the resolution cache missed or **`forceRefresh`**) and one for **`jvmsrcResolveSources`** for the winning artifact. Sequential warm runs are much faster when the Gradle daemon is already up and artifacts are cached under **`~/.gradle`**.

```typescript
const useWrapper = fs.existsSync(path.join(projectRoot, 'gradlew'));
const initScript = getBundledResource('analyzer-init.gradle'); // package-root absolute path

const argv = [
  ...(useWrapper ? [path.join(projectRoot, 'gradlew')] : ['gradle']),
  `-PjvmsrcWrapper=${useWrapper}`,
  '--no-configuration-cache',
  '--init-script',
  initScript,
  '--quiet',
  'jvmsrcResolve',
];

const proc = Bun.spawn(argv, { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
// await streams + exit code → parse stdout JSON → validate schemaVersion → ResolutionResult
```

### 5.3 Init Script Contract

The bundled `analyzer-init.gradle` registers a **single root task** named `jvmsrcResolve` from `gradle.projectsLoaded`. Running that task walks **all** Gradle subprojects once and prints **one** JSON document to stdout (the `ResolutionOutput` in §5.5.2). The Node side parses that single blob; there is no merge step for multiple per-project prints.

**Critical design decisions baked into the init script:**

- **Eager multi-scope output.** Each module lists `compileClasspath`, `runtimeClasspath`, `testCompileClasspath`, and `testRuntimeClasspath` when those configurations exist. Callers that only need compile scope still benefit from one Gradle invocation.
- **Targets `compileClasspath` by default** for class lookup semantics — it is what the compiler sees. `runtimeClasspath` adds artifacts the agent cannot always import; both are still resolved and cached.
- **Outputs resolved versions, not declared ranges.** Gradle’s resolution graph (including conflict resolution and BOMs) determines coordinates; the `direct` flag marks first-level vs transitive edges.
- **Inter-project vs external.** Project components are emitted as `origin: "interproject"` with `interproject.modulePath`. External modules use resolved JAR paths. Artifact files under **other subprojects’ `buildDir`** are filtered out so the same logical dependency is not listed twice as both a project edge and a built JAR.
- **Suppresses Gradle chatter** with `--quiet` and prints only the structured JSON via `println`.

### 5.4 Multimodule Handling

For a multimodule Gradle project, the tool resolves and indexes all submodules in one Gradle invocation. The caller may then scope a class lookup to a specific module:

```bash
# Resolves against the root project (union of all modules)
jvmsrc com.example.MyClass --project /path/to/project

# Explicit get (equivalent)
jvmsrc get com.example.MyClass --project /path/to/project

# Resolves against a specific submodule
jvmsrc com.example.MyClass --project /path/to/project --module :core:utils
```

When `--module` is omitted on a multimodule project, the tool uses the union of all modules' resolved artifacts. If the same class exists in multiple modules with different versions, the tool surfaces the conflict explicitly rather than picking silently.

### 5.5 Resolution output format

#### 5.5.1 Eager Multi-Scope Resolution

The init script resolves **all configurations for every submodule in a single Gradle invocation**. This is a deliberate performance trade-off: Gradle's startup and configuration cost is paid once, and the resulting cache file is complete regardless of which configuration the caller later queries. Subsequent class lookups — regardless of scope — always hit the in-memory or disk cache rather than re-invoking Gradle.

Configurations resolved per module:

- `compileClasspath` — what the compiler sees; the primary scope for agent code writing
- `runtimeClasspath` — adds runtime-only artifacts (drivers, logging impls, etc.)
- `testCompileClasspath` — compile-time additions for test sources
- `testRuntimeClasspath` — full classpath available during test execution

Any configuration that cannot be resolved (e.g. does not exist in a given submodule) is silently skipped rather than treated as an error.

#### 5.5.2 JSON Schema

The init script emits a single JSON document to stdout. The Node process captures it, validates the `schemaVersion`, writes it to the resolution cache, and uses it for all subsequent lookups without re-invoking Gradle.

```typescript
interface ResolutionOutput {
  schemaVersion: string;            // "1.0" or "1.1" — bump on breaking changes
  resolvedAt: string;               // ISO 8601 UTC timestamp
  buildSystem: BuildSystemInfo;
  projectRoot: string;              // absolute path — used to validate cache portability
  modules: ResolvedModule[];
  errors: ResolutionError[];        // partial failures; non-empty does not mean total failure
}

interface BuildSystemInfo {
  type: "gradle" | "maven";         // extensible as new resolvers are added
  version: string;                  // e.g. "8.7" — the actual Gradle version used
  wrapper: boolean;                 // true = ./gradlew used; false = system gradle
}

interface ResolvedModule {
  name: string;                     // e.g. ":app", ":core:utils", "root"
  path: string;                     // absolute filesystem path to the submodule root
  configurations: ResolvedConfiguration[];
}

interface ResolvedConfiguration {
  name: string;                     // e.g. "compileClasspath", "testRuntimeClasspath"
  scope: "compile" | "runtime" | "test-compile" | "test-runtime";
  artifacts: ResolvedArtifact[];
}

interface ResolvedArtifact {
  group: string;
  name: string;
  version: string | null;           // null for interproject deps (no version concept)
  type: "jar" | "project" | "local-file";
  jarPath: string | null;           // null for interproject deps (key may be omitted in 1.1 JSON)
  sourcesJarPath?: string | null;   // 1.1: omitted when null; normalized to null after parse
  origin: "external" | "interproject" | "local-file";
  direct: boolean;                  // true = declared in build file; false = transitive
  interproject?: InterprojectRef;   // present only when origin = "interproject"
}

interface InterprojectRef {
  moduleName: string;               // e.g. ":core:utils"
  modulePath: string;               // absolute path to that submodule's root
}

interface ResolutionError {
  module: string;                   // submodule name, or "root" for project-level failures
  configuration?: string;           // omitted if failure is not configuration-specific
  message: string;
  fatal: boolean;                   // fatal=true means the whole resolution failed
}
```

#### 5.5.3 Canonical Example

```json
{
  "schemaVersion": "1.1",
  "resolvedAt": "2026-05-14T10:23:00Z",
  "buildSystem": {
    "type": "gradle",
    "version": "8.7",
    "wrapper": true
  },
  "projectRoot": "/home/user/projects/my-app",
  "modules": [
    {
      "name": ":app",
      "path": "/home/user/projects/my-app/app",
      "configurations": [
        {
          "name": "compileClasspath",
          "scope": "compile",
          "artifacts": [
            {
              "group": "org.springframework.boot",
              "name": "spring-boot-starter-web",
              "version": "3.2.1",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-web/3.2.1/abc123/spring-boot-starter-web-3.2.1.jar",
              "sourcesJarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-web/3.2.1/def456/spring-boot-starter-web-3.2.1-sources.jar",
              "origin": "external",
              "direct": true
            },
            {
              "group": "org.springframework",
              "name": "spring-core",
              "version": "6.1.2",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework/spring-core/6.1.2/xyz789/spring-core-6.1.2.jar",
              "sourcesJarPath": null,
              "origin": "external",
              "direct": false
            },
            {
              "group": "com.mycompany",
              "name": "core-utils",
              "version": null,
              "type": "project",
              "jarPath": null,
              "sourcesJarPath": null,
              "origin": "interproject",
              "direct": true,
              "interproject": {
                "moduleName": ":core:utils",
                "modulePath": "/home/user/projects/my-app/core/utils"
              }
            }
          ]
        },
        {
          "name": "runtimeClasspath",
          "scope": "runtime",
          "artifacts": [
            {
              "group": "org.springframework.boot",
              "name": "spring-boot-starter-web",
              "version": "3.2.1",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-web/3.2.1/abc123/spring-boot-starter-web-3.2.1.jar",
              "sourcesJarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-web/3.2.1/def456/spring-boot-starter-web-3.2.1-sources.jar",
              "origin": "external",
              "direct": true
            },
            {
              "group": "ch.qos.logback",
              "name": "logback-classic",
              "version": "1.4.14",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/ch.qos.logback/logback-classic/1.4.14/aaa111/logback-classic-1.4.14.jar",
              "sourcesJarPath": null,
              "origin": "external",
              "direct": false
            }
          ]
        },
        {
          "name": "testCompileClasspath",
          "scope": "test-compile",
          "artifacts": [
            {
              "group": "org.springframework.boot",
              "name": "spring-boot-starter-test",
              "version": "3.2.1",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-test/3.2.1/bbb222/spring-boot-starter-test-3.2.1.jar",
              "sourcesJarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-test/3.2.1/ccc333/spring-boot-starter-test-3.2.1-sources.jar",
              "origin": "external",
              "direct": true
            }
          ]
        },
        {
          "name": "testRuntimeClasspath",
          "scope": "test-runtime",
          "artifacts": [
            {
              "group": "org.springframework.boot",
              "name": "spring-boot-starter-test",
              "version": "3.2.1",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-test/3.2.1/bbb222/spring-boot-starter-test-3.2.1.jar",
              "sourcesJarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.springframework.boot/spring-boot-starter-test/3.2.1/ccc333/spring-boot-starter-test-3.2.1-sources.jar",
              "origin": "external",
              "direct": true
            },
            {
              "group": "org.junit.jupiter",
              "name": "junit-jupiter-engine",
              "version": "5.10.1",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/org.junit.jupiter/junit-jupiter-engine/5.10.1/ddd444/junit-jupiter-engine-5.10.1.jar",
              "sourcesJarPath": null,
              "origin": "external",
              "direct": false
            }
          ]
        }
      ]
    },
    {
      "name": ":core:utils",
      "path": "/home/user/projects/my-app/core/utils",
      "configurations": [
        {
          "name": "compileClasspath",
          "scope": "compile",
          "artifacts": [
            {
              "group": "com.google.guava",
              "name": "guava",
              "version": "32.1.3-jre",
              "type": "jar",
              "jarPath": "/home/user/.gradle/caches/modules-2/files-2.1/com.google.guava/guava/32.1.3-jre/abc111/guava-32.1.3-jre.jar",
              "sourcesJarPath": "/home/user/.gradle/caches/modules-2/files-2.1/com.google.guava/guava/32.1.3-jre/def222/guava-32.1.3-jre-sources.jar",
              "origin": "external",
              "direct": true
            }
          ]
        }
      ]
    }
  ],
  "errors": [
    {
      "module": ":legacy:service",
      "configuration": "compileClasspath",
      "message": "Could not resolve com.internal:private-lib:2.0.0 — repository unreachable",
      "fatal": false
    }
  ]
}
```

#### 5.5.4 Field Rationale

| Field | Rationale |
|---|---|
| `schemaVersion` | Cache files from older runs can be detected and invalidated rather than silently misread when the format evolves |
| `resolvedAt` | Allows time-based staleness checks as a secondary invalidation signal alongside the build-file hash |
| `buildSystem.wrapper` | Flags whether resolution used the project-local `./gradlew` (version-accurate) or a system `gradle` (potentially mismatched); surfaced as a warning if `false` |
| `projectRoot` in output | Cache file is self-describing; a cache found at an unexpected path can be validated against its own declared root |
| `configurations` as array | Preserves the full scope structure — `compileClasspath` and `runtimeClasspath` have different resolved sets; flattening loses information the extractor needs |
| `direct: boolean` | Distinguishes declared from transitive deps; a class found in a `direct: true` artifact is a stronger match signal |
| `origin` enum | Three fundamentally different artifact kinds require different downstream handling: `external` → JAR in cache, `interproject` → redirect to source dir, `local-file` → raw path |
| `version: null` for interproject | Explicit null is better than omitting the field; the consumer knows the field exists but the concept does not apply |
| `sourcesJarPath` | For **`schemaVersion` `1.1`**, Gradle may **omit** the key when there is no sources artifact on the classpath edge; consumers normalize missing values to **`null`**. Same semantics as before: on-demand sources use **`jvmsrcResolveSources`**. |
| `errors` always present | Partial resolution failures (one unreachable submodule) should not discard results for the rest; non-empty errors array does not mean the output is unusable |
| Artifact identity | Rows are unique by **`group` + `name` + `version`** (with `version: null` for inter-project). Multiple rows sharing the same `group` are normal (different artifact names). |
| `buildDir` filtering | External JARs whose paths live under **another** subproject’s `buildDir` are skipped so a dependency is not double-counted as both an inter-project edge and a built output JAR. |
| Configuration cache | Consumers must pass **`--no-configuration-cache`** for the current root-task design (see §5.2); Gradle may still write to `~/.gradle` as usual. |

#### 5.5.5 Validated behavior (POC → product)

The following behaviors were validated against real Gradle builds before folding the POC into `analyzer-init.gradle` and `GradleResolver`:

- **Zero writes under the target repo** for resolution — only an external init script path is passed; Gradle may use global caches as always.
- **True Gradle resolution** — coordinates are **resolved** (including transitives and conflict resolution), not guessed from `~/.gradle` directory listing.
- **Single JSON document** per invocation, eager four-scope output per module, `errors[]` for partial failures.
- **Inter-project vs external** — project dependencies carry `interproject`; sibling `buildDir` artifacts are filtered from the external list.

#### 5.5.6 Gradle configurations collected

`jvmsrcResolve` walks every submodule and, **for each configuration name that exists**, collects resolved artifacts: **`compileClasspath`**, **`runtimeClasspath`**, **`testCompileClasspath`**, **`testRuntimeClasspath`**, **`jvmCompileClasspath`**, **`jvmRuntimeClasspath`**, **`jvmTestCompileClasspath`**, **`jvmTestRuntimeClasspath`** (the `jvm*` names support Kotlin Multiplatform JVM publications when present).

**Android:** variant-specific classpaths (for example **`debugCompileClasspath`**, **`releaseCompileClasspath`**) are **not** collected by default — Android modules can expose many variants, which would multiply Gradle configuration work. Prefer JVM library modules for default **`jvmsrc`** classpath queries, pass **`--configuration`** when your graph exposes a stable custom configuration, or extend the init script locally if you need a dedicated Android scope.

## 6. Caching Strategy

### 6.1 Resolution Cache

Gradle invocation is expensive (often ~5–10 seconds; less when the Gradle daemon is already warm). The tool caches the full **`ResolutionOutput`** JSON (same structure as §5.5.2 / Gradle stdout) and invalidates it when **declared build inputs** change.

**Cache key:** SHA-256 digest over the content of all build-relevant files in the project (sorted paths, stable manifest — see implementation `computeBuildInputsDigest`):

- `build.gradle` / `build.gradle.kts` (all submodules; common output directories such as `build/`, `.gradle/`, and `node_modules/` are excluded from the walk)
- `settings.gradle` / `settings.gradle.kts` (project root)
- `gradle/libs.versions.toml` (version catalog, if present)
- `gradle/dependency-locks/*.lockfile` (if present)

**Cache location (nothing under the scanned project tree):** resolution data lives under the OS cache directory from [`env-paths`](https://github.com/sindresorhus/env-paths) with app name **`jvmsrc`** (same as the CLI binary) and **no** `nodejs` suffix (`suffix: ''`), so typical roots are:

- Linux: `~/.cache/jvmsrc` (or `$XDG_CACHE_HOME/jvmsrc` when set)
- macOS: `~/Library/Caches/jvmsrc`
- Windows: `%LOCALAPPDATA%\jvmsrc\Cache`

**Per-project bucket:** under that root, `projects/<projectBucketId>/` where `projectBucketId` is the first **8** hexadecimal characters of SHA-256(UTF-8 of the **canonical absolute** project root). Files in the bucket:

| File | Role |
|------|------|
| `resolution.json` | Strict `ResolutionOutput` only (no extra fields) |
| `resolution.hash` | Single line: lowercase hex digest of the build-input set above |
| `bucket-meta.json` | Small envelope: `cacheMetaVersion`, `projectRootAbsolute`, `projectRootDigestFull`, `writtenAt` (ISO UTC) |
| `class-search-index.json` | Optional sidecar: built for **`search_classes`** (format version 3); invalidated when resolution fingerprint / scope changes |
| `jar-fqn-cache.json` | Optional sidecar: per-binary-JAR FQN lists keyed by absolute `jarPath` with **`mtimeMs:size`** stat keys; reused when a JAR file is unchanged so class-search rebuilds skip re-reading unchanged ZIP central directories |

The top-level `decompiled/` directory under the same cache root is reserved for the shared decompile store (§6.2). A top-level `gc.json` is reserved for a future GC pass over stale project buckets.

**Optional override:** **`JVMSRC_LOG_DIR`** (structured failure diagnostics, **§6.3**) uses the same absolute-path-only policy as **`JVMSRC_CACHE_ROOT`**.

**Optional override:** if **`JVMSRC_CACHE_ROOT`** is set, it must be a **non-empty absolute** path; relative values are rejected with a structured error (they would depend on the process working directory). When valid, the tool uses that directory as the global cache root instead of the env-paths default (useful for tests and locked-down environments).

**Durability:** bucket files (`resolution.json`, `resolution.hash`, `bucket-meta.json`) are each written via a **temporary file in the same directory followed by `rename`**, so concurrent readers are less likely to observe a torn combination than with in-place overwrites.

When the build-input digest matches `resolution.hash`, the cached document is used immediately (no Gradle). When it differs, Gradle is re-invoked and the bucket is overwritten. **`jar-fqn-cache.json`** (see table above) stores per-JAR FQN lists with stat-based reuse so **`class-search-index.json`** rebuilds avoid re-scanning unchanged dependency JARs after small resolution graph changes.

**Escape hatch — `forceRefresh`:** Hash keys only cover tracked build inputs (`build.gradle*`, `settings.gradle*`, version catalogs, lockfiles). They do **not** detect SNAPSHOT bumps in a remote repo, a teammate clearing `~/.gradle`, or CI using a fresh dependency cache while build files are unchanged. **`resolve_dependencies`** (MCP), **`jvmsrc resolve --force-refresh`**, and **`jvmsrc get --force-refresh`** bypass the resolution cache and **always** re-invoke Gradle so the agent or developer can re-resolve without manually deleting cache files.

### 6.2 Decompilation Cache

CFR decompilation results are cached by artifact coordinates + class name under the **same global cache root** as §6.1 (not under the project directory):

```
<env-paths cache for jvmsrc>/
  decompiled/<group>/<artifact>/<version>/<ClassName>.java
```

This means sequential agent calls for classes within the same dependency pay the decompilation cost only once, and the store can be shared across projects on one machine. Files are written on the first decompile miss (atomic temp + rename, same pattern as resolution cache buckets).

**Security (decompile path):**

- **Untrusted bytecode:** CFR executes JVM bytecode from dependency JARs. Treat decompilation as running third-party code in a local JDK process (same trust boundary as Gradle). Use only on projects and dependencies you trust.
- **Cache confinement:** Cache file paths are built only from sanitized Maven coordinates and a validated simple class name; writes are refused unless the resolved path stays under `decompiled/`. Segments `.`, `..`, and `..` substrings in coordinates are rejected.
- **Subprocess env:** CFR spawns use a stripped environment (no `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`, `CLASSPATH`, `LD_PRELOAD`, etc.) so parent-process JVM injection does not apply to the child.
- **Limits:** CFR runs with a wall-clock timeout (default 120s, `JVMSRC_CFR_TIMEOUT_MS`) and stdout cap (default 10 MiB, `JVMSRC_CFR_MAX_OUTPUT_BYTES`).
- **Shared cache:** The `decompiled/` tree is machine-local and shared across projects. Another user or process with access to the same cache directory could read cached `.java` files; keep `JVMSRC_CACHE_ROOT` private on multi-user hosts.
- **Agent trust:** Decompiled stdout is structurally useful but not authoritative (see §7.1 `sourceAvailable: false`). Agents must not treat decompiled text as ground truth for security-sensitive decisions (secrets, auth checks, crypto).

### 6.3 Structured failure diagnostics

**Problem.** Callers (agents, scripts) need concise, stable failures (public **`code`** values in §7). Operators debugging Gradle/CFR integration issues need subprocess output and environment context without filling the agent context window or manually reproducing every failure.

**Pattern — structured diagnostic logging.** On failure, the tool writes a **structured diagnostic record** to a machine-local log (**side channel**). Normal responses stay unchanged: **`{ ok: false }`** results, MCP envelopes, and CLI stderr / **`--json`** stdout keep their existing shapes. **`user_error`** and **`expected`** severities are intentionally low-noise; **`internal`** always warrants full context. **Diagnostic write failures must never cause the overall operation to fail** (aligned with §4.2: only corrupted-install resource helpers may throw).

**Severity taxonomy** (orthogonal to public **`code`** — relationship summarized in §7):

```typescript
enum FailureSeverity {
  USER_ERROR     = 'user_error',      // bad input, unsupported project type
  EXPECTED       = 'expected',        // class not found, no sources JAR (normal outcome)
  ENV_ERROR      = 'env_error',       // Java missing, Gradle wrapper missing
  RESOLVER_FAIL  = 'resolver_fail',   // Gradle/Maven invocation failed or unusable output
  PARSER_FAIL    = 'parser_fail',     // ResolutionOutput malformed / schema mismatch
  DECOMPILE_FAIL = 'decompile_fail',  // CFR failed or unusable output
  CACHE_FAIL     = 'cache_fail',      // cache read/write (permissions, disk)
  INTERNAL       = 'internal',        // unhandled exception — treat as bug
}
```

**Diagnostic record** (conceptual schema):

```typescript
interface DiagnosticRecord {
  id: string;                      // UUID — correlate entries
  timestamp: string;               // ISO 8601
  severity: FailureSeverity;
  toolVersion: string;             // jvmsrc package version

  operation: string;               // e.g. 'get_class_source', 'resolve_dependencies'
  input: Record<string, unknown>;  // sanitized — no secrets

  message: string;
  errorCode: string;               // stable machine-readable, e.g. 'GRADLE_EXIT_NONZERO'
  stack: string | null;            // stack for INTERNAL; null otherwise

  context: {
    platform: string;
    arch: string;
    nodeVersion: string;
    javaVersion: string | null;    // e.g. from `java -version`; null if unavailable
    gradleVersion: string | null; // e.g. from wrapper properties; null if unavailable
    projectRoot: string;
    buildSystem: string | null;
    cacheDir: string;
  };

  subprocess?: {
    command: string[];
    exitCode: number | null;
    stdout: string;                // tail — last 4 KiB (policy)
    stderr: string;                // tail — last 4 KiB
  };
}
```

The **`subprocess`** block is especially valuable for **`resolver_fail`** and **`decompile_fail`**: it records what Gradle (**`jvmsrcResolve`**, **`jvmsrcResolveSources`**) or CFR emitted without requiring a local rerun.

**Storage — distinct from resolution/decompile cache (§6.1–§6.2).** Diagnostics use **state/log–style** roots (persistent, meaningful logs — not **`env-paths` cache**, which is safe to delete). Under **`$LOG_ROOT/jvmsrc/`**:

```
current.log              ← newline-delimited JSON (one record per line), rolling
current.log.1, .2, …     ← numbered rotations
diagnostics/
  <id>.json              ← full JSON for selected severities (easy open without grep)
```

| Platform | Default log directory (`$LOG_ROOT/jvmsrc`) |
|---|---|
| Linux | `$XDG_STATE_HOME/jvmsrc` when set, otherwise `~/.local/state/jvmsrc` |
| macOS | `~/Library/Logs/jvmsrc/` |
| Windows | `%LOCALAPPDATA%\jvmsrc\Logs\` |

On Linux, **`XDG_STATE_HOME`** (not **`XDG_CACHE_HOME`**) matches the usual distinction: state/logs remain meaningful for backups and ops; cache remains disposable.

**Override:** **`JVMSRC_LOG_DIR`** — when set, must be a **non-empty absolute** path; relative values are rejected (same policy as **`JVMSRC_CACHE_ROOT`** in §6.1).

**Rotation and retention** (planned defaults):

| Policy | Value |
|---|---|
| Rotate **`current.log`** | when file exceeds 5 MiB |
| Numbered rotations | keep current + 3 backups (~20 MiB total typical cap) |
| **`diagnostics/<id>.json`** | **`resolver_fail`**, **`parser_fail`**, **`decompile_fail`**, **`internal`** |
| Max **`diagnostics/`** files | 50 — drop oldest when exceeded |
| Age GC | remove diagnostic files older than 30 days |

Rotation runs synchronously before append when the size threshold is exceeded (writes are infrequent; no background thread required).

**Severity → owner / typical action:**

| Severity | Owner | Typical action |
|---|---|---|
| `user_error` | Agent / user | Fix input; no tool change |
| `expected` | — | Normal operation; monitor frequency only |
| `env_error` | User environment | PATH, JDK install, wrapper |
| `resolver_fail` | Usually user's project | Gradle configuration/logs; sometimes jvmsrc bug |
| `parser_fail` | jvmsrc | ResolutionOutput parsing / schema |
| `decompile_fail` | jvmsrc | CFR invocation / output handling |
| `cache_fail` | User environment | Permissions / disk on cache dir |
| `internal` | jvmsrc | File a bug; stack trace in record |

**Boundary hook.** A conceptual **`withDiagnostics(operation, sanitizedInput, fn)`** wraps CLI, MCP, and library entry points. Implementations may emit diagnostics on **`{ ok: false }`** paths without adopting exceptions throughout the pipeline.

**Agent vs developer surfaces.** The agent receives a **clean** message and stable **`code`** (and optionally **`diagnosticId`** + **`hint`**). The developer opens **`diagnostics/<id>.json`** or tails **`current.log`**. Example bridge (illustrative):

```json
{
  "error": "Could not resolve dependencies for project at /home/user/my-app.",
  "code": "RESOLUTION_FAILED",
  "diagnosticId": "a3f5c8d2-…",
  "hint": "Run `jvmsrc diagnostics show a3f5c8d2` for details."
}
```

CLI (**§8.1.1** error JSON, **§8.1.3** `diagnostics` subcommand) and MCP (**§8.2**) may expose the same conceptual fields where applicable.

---

## 7. Class Extraction Logic

Once a **`ResolutionOutput`** is loaded (from cache or a fresh Gradle run), the extractor picks the relevant `ResolvedConfiguration` using `ResolveOptions`, then class lookup follows this priority order:

```
1. Is this class in an inter-project dependency?
      YES → return the source file path from the local subproject
      
2. Does a sources JAR exist for the owning artifact?
      YES → extract and return the .java file from the sources JAR
      
3. Does a classes JAR exist?
      YES → check decompilation cache
            HIT  → return cached decompiled source
            MISS → decompile with CFR, cache result, return source
            
4. Class not found in any resolved artifact?
      → Return structured error: class name, searched artifacts, suggestion
        to verify the class name or check if the dependency is declared
```

**Current `jvmsrc get` / library behavior:** **Step 1 (`origin: interproject`)** is implemented: before **`origin: external`** JAR edges, the extractor reads **the selected module's own** **`src/main/java/...`** and, when **`includeTest`** is **`true`**, **`src/test/java/...`**, then sibling **`<interproject.modulePath>/src/...`** trees (Gradle does not list the querying module as an inter-project edge on its own classpath). Omitting **`configuration`** and enabling **`includeTest`** selects **`testCompileClasspath`** or **`jvmTestCompileClasspath`** (Kotlin MPP) when present in **`ResolutionOutput`**. A hit returns original **`.java`** with **`sourceAvailable: true`** and **`provenance.kind: "interproject"`** (`moduleName`, coordinates, **`moduleRoot`**, **`absoluteSourcePath`**). **`get_method_signature`** and **`get_class_structure`** prefer the same classpath-ordered **`.java`** read (**inter-project disk**, then **sources JAR** / on-demand **`jvmsrcResolveSources`**) and parse declarations before **`javap -private -verbose`**; **`javap`** still backs overload metadata when only bytecode exists (external artifacts without sources, or unparsable source), and drives inheritance whenever bytecode for a supertype/interface is available (with source fallback when **`javap`** cannot run because **`build/classes/**`** is missing). **Steps 2–4** still apply to **`origin: external`** (prefer **`-sources.jar`**, **`jvmsrcResolveSources`**, global **`decompiled/`**, CFR **`sourceAvailable: false`**).

**Stable `code` values** on failures: **`RESOLUTION_FAILED`**, **`SOURCES_RESOLVE_FAILED`**, **`INVALID_FQN`**, **`MODULE_NOT_FOUND`**, **`CONFIGURATION_NOT_FOUND`**, **`ZIP_READ_ERROR`**, **`CLASS_NOT_FOUND`**, **`DECOMPILE_FAILED`**, **`SIGNATURE_EXTRACT_FAILED`**, **`EXCERPT_REQUEST_INVALID`**, **`EXCERPT_NOT_FOUND`**, **`FIND_QUERY_INVALID`**, **`FIND_SOURCE_TOO_LARGE`**. **`SIGNATURE_EXTRACT_FAILED`** covers **javap** failures for **`get_method_signature`** (per-method) and **`get_class_structure`** (whole-class disassembly; `methodName` may be omitted in the error object). Excerpt failures apply when **`get_class_source`** / CLI **`get`** is called with **`methodNames`** / **`methodName`** and/or **`startLine`** / **`endLine`**. Find-in-source failures apply to **`find_in_class_source`** / CLI **`find-in-class`**.

**Diagnostics (§6.3):** public **`code`** values remain the **stable API contract** for callers. Diagnostic records add **`severity`** and granular **`errorCode`** (e.g. **`GRADLE_EXIT_NONZERO`**, **`JAVA_NOT_FOUND`**) for operators and bug reports; implementations map failures to both layers without renaming published **`code`** values.

The tool **never falls back to scanning the global cache** without a resolved tree. If Gradle resolution fails, the tool reports the failure — it does not attempt to guess from `~/.gradle/caches`.

### 7.1 `sourceAvailable` on source-bearing responses

Every response that returns **Java source text** (CLI `get` stdout, MCP `get_class_source`, and any library API that returns a source string) includes a boolean **`sourceAvailable`** (or equivalent field in the structured envelope):

- **`true`** — text came from **original source** (project sources, inter-project files, or a **sources JAR**). Javadoc, parameter names (as compiled), and generics match what the author shipped.
- **`false`** — text came from **decompiled bytecode** (CFR). Structurally reliable, but Javadoc is absent, parameter names may be missing unless the dependency was built with `-parameters`, and complex generics can be approximated.

### 7.2 Method and structure inspection (IDE-first)

**Product intent:** **`get_method_signature`** and **`get_class_structure`** are meant to replicate what you get when you **open a type in an IDE**: declarations as written (parameters, return types, **`throws`**, generics **as text** where parsing succeeds), **Javadoc** on the primary type where sources are used, and enough hierarchy / overload detail to **navigate** (then **`get_class_source`** when the body matters). They are **not** trying to be a full **`javap -verbose`** substitute on the default path.

**How it works today:** Both tools **prefer** classpath-ordered **`.java`**: **`interproject`** sibling **`src/main/java`** or **`src/test/java`** when **`includeTest`**, then **sources JAR** / on-demand **`jvmsrcResolveSources`**, plus a lightweight declaration parse. **`javap -private -verbose`** is used when sources are missing, unparsable, or to walk **inheritance** when bytecode for a supertype or interface is available—**without** requiring sibling **`build/classes/**`** when source-only inter-project deps exist.

**Bytecode-shaped fields:** When metadata comes from **source parsing**, MCP payloads omit bytecode-only fields where practical: **`get_method_signature`** overload objects omit **`flagsLine`**, **`genericSignature`**, and **`jvmDescriptor`** unless the parse exposes a non-synthetic descriptor; **`get_class_structure`** omits **`jvmDescriptor`** (and **`genericSignature`**) on **non-inherited** declared members when the descriptor would be the internal **`#SRC:`** merge key only. When metadata comes from **`javap`**, those fields reflect the classfile (**`Signature`**, **`Exceptions`**, **`LocalVariableTable`** names where present).

**Advanced inspection:** MCP **`get_method_signature`** accepts optional **`bytecodeOnly: true`** — **`javap -private -verbose`** only (no **`src/`** or sources-JAR fallback); **`sourceAvailable`** is always **`false`**. Default (omit flag) is IDE-like browsing first (§8.2).

**`sourceAvailable` on these tools:** **`get_class_structure`** sets **`true`** when the **primary** type’s declarations came from original source. **`get_method_signature`** sets **`true`** when overloads were produced from that source-parse path; **`false`** when the **`javap`** path supplied them. Inherited layers may mix source-derived and **`javap`**-derived rows depending on whether each supertype/interface had readable **`.java`** or only bytecode.

Agents should treat `sourceAvailable: false` as “trust types and control flow; treat names and comments as best-effort.” Do not rely on decompiled output for security reviews, credential handling, or proving absence of malicious behavior — it is recovered from bytecode, may omit comments, and is produced by a subprocess on untrusted classes. For overload browsing like an IDE, prefer **`get_method_signature`** / **`get_class_structure`** on the source-first path; use **`get_class_source`** when signatures plus Javadoc are not enough; use **`forceRefresh`** when resolution is stale.

---

## 8. Interface Layer

### 8.1 CLI

The published executable is **`jvmsrc`**. Class lookup may be written as **`jvmsrc get <className>`** or the shorthand **`jvmsrc <className>`** — when the first argument is not `get`, `mcp`, `config`, **`resolve`**, or **`diagnostics`** (§8.1.3), the CLI treats it as a class name and runs the `get` command (same flags: `--project`, `--module`, etc.).

```bash
# Install globally
npm install -g jvmsrc

# Or run without installation
npx jvmsrc get com.example.MyClass

# Resolve Gradle graph to stdout (uses resolution cache; see §6.1)
jvmsrc resolve --project /path/to/project
jvmsrc resolve --project /path/to/project --force-refresh

# With options
jvmsrc get com.example.MyClass \
  --project /path/to/project \
  --module :core:utils \
  --configuration compileClasspath

# Default configuration is compileClasspath; use testCompileClasspath when --configuration is omitted:
jvmsrc get com.example.MyClass --project /path/to/project --include-test

# Re-resolve Gradle graph (same as resolve --force-refresh)
jvmsrc get com.example.MyClass --project /path/to/project --force-refresh

# Shorthand (equivalent to: jvmsrc get com.example.MyClass …)
jvmsrc com.example.MyClass --project /path/to/project

# Pipe-friendly: no metadata line on stderr
jvmsrc get com.example.MyClass --project /path/to/project --quiet
jvmsrc get com.example.MyClass -p /path/to/project -q

# One JSON object on stdout (success or failure)—same facts as MCP get_class_source
jvmsrc get com.example.MyClass --project /path/to/project --json
```

#### 8.1.1 `get` output contract (CLI)

**`jvmsrc resolve`** writes pretty-printed **`ResolutionOutput`** JSON to **stdout** only. While Gradle runs, **stderr** may show phased **`[jvmsrc] …`** lines (or Gradle’s own stderr if **`--verbose` / `-v`**). **`jvmsrc get`** uses the same progress rules on **stderr** for Gradle work; add **`--verbose`** to stream Gradle stderr during resolution and sources JAR fetch.

**`jvmsrc get`** uses two streams on purpose so **stdout stays pipeable** as a single `.java` file:

| Stream | On success | On failure |
|--------|------------|------------|
| **stdout** | Raw Java source (file body only) | (empty) |
| **stderr** | One JSON line: `sourceAvailable`, `className`, `provenance` (§7.1) | One JSON line: `{ "error": true, "code": "…", … }` (stable codes in §7) |
| **Exit code** | `0` | non-zero |

Example success metadata (stderr, default mode):

```json
{"sourceAvailable":true,"className":"com.example.Foo","provenance":{"kind":"sourcesJar","coordinates":{"group":"…","name":"…","version":"…"},"jarPath":"/path/to/…-sources.jar"}}
```

**`--quiet` / `-q`:** on success, write **only** the Java source to stdout; **do not** print the metadata JSON to stderr. **Also disables** phased **`[jvmsrc]`** progress on stderr (Gradle CFR phases and dependency resolution). Errors are unchanged (still JSON on stderr in default mode, non-zero exit). Use for shell pipelines (`jvmsrc get … -q > Foo.java`) when you do not need provenance on the terminal.

**`--verbose` / `-v` (`get` and `resolve`):** stream **Gradle** stderr to the terminal for the main **`jvmsrcResolve`** run and for **`jvmsrcResolveSources`** on **`get`** (live build output). When **`--verbose`** is set, phased progress lines are not shown for those Gradle invocations (Gradle output replaces them). CFR decompilation still emits a phased **`[jvmsrc] Decompiling with CFR…`** line on **`get`** when progress is enabled (i.e. not **`--quiet`**).

**Excerpt (optional):** **`--method <name>`** (repeatable; **`<init>`** for constructors) and/or **`--start-line`** / **`--end-line`** (1-based inclusive; both required) return only the requested method bodies and/or line slice — same semantics as MCP **`get_class_source`** excerpt arguments (§8.2). **Success** metadata (stderr or **`--json`**) may include **`excerpt`** with **`matchedMethodNames`**, **`unmatchedMethodNames`**, and **`lineNumbersReliable`** (**`false`** when **`sourceAvailable: false`**).

**`--json`:** write **one compact JSON line** to **stdout** for both success and failure; **nothing** to stderr. **Success:** `source`, `sourceAvailable`, `className`, `provenance`, optional **`excerpt`** (same shape as MCP **`get_class_source`**, §8.2). **Failure:** `{ "error": true, "code": "…", … }` using the same stable **`code`** values as default mode (§7). **Invalid `--project`:** stdout only: `{ "error": true, "code": "INVALID_PROJECT_ROOT", "message": "…" }` (CLI validation; not an extractor error). Non-zero exit on failure. With **`--json`**, **`--quiet` / `-q`** has no extra effect (stdout is already a single structured object).

**Failure diagnostics:** when a diagnostic file is written for a failure, CLI error JSON (**stderr** one-liner or **`--json`** stdout object) **may** include **`diagnosticId`** and **`hint`** pointing to **`jvmsrc diagnostics show <id>`** — same conceptual bridge as MCP (**§8.2**).

The **MCP** server tool **`get_class_source`** (§8.2) exposes the same facts in a single structured result (`source`, `sourceAvailable`, provenance fields) — no stdout/stderr split — which is better for IDE agents.

#### 8.1.2 `config` subcommand

**`jvmsrc config`** prints one JSON document to **stdout**: a paste-ready **`mcpServers.jvmsrc`** block (same shape as §8.2) plus a **`hints`** object (`packageVersion`, `projectRoot`, `hasGradleWrapper`, `javaHome`, `javaDetected`). Use **`--project <path>`** (default: current working directory) only to tune Gradle-wrapper detection for hints.

When you run the CLI from this repository via **`bun run src/cli.ts`**, the snippet uses **`bun run …/src/mcp.ts`** so agents start the MCP entry without a global install. When running the published **`jvmsrc`** binary, the snippet uses that binary’s path with **`args: ["mcp"]`**.

#### 8.1.4 Response detail (compact vs full)

**Default:** **compact** — human-readable **plain text** on CLI stdout or MCP `content` (`type: text`). **No JSON** on compact success (including no “small summary” JSON objects).

**Full:** MCP optional **`full: true`**; CLI **`--full`** or **`--json`** on commands that support structured output. Full mode returns the same JSON shapes documented below (`structuredContent` on MCP). Temporary migration: env **`JVMSRC_DEFAULT_DETAIL=full`**.

**CLI `get`:** unchanged pipe contract — success stdout is raw `.java`; compact MCP returns source text + plain provenance footer. **`--verbose` / `-v`** streams Gradle stderr only (not payload detail).

**`get_class_structure`:** optional **`scope`**: `overview` (default compact), `declared`, `effective`. Method lines look like source declarations, e.g. `calculate(long price, long quantity)`. Inherited methods capped in `effective` with a plain-text footer. **`full: true`** or **`scope: full`** → JSON payload.

**Agent guidance:** discovery uses compact text and the narrowest tool (`search_classes` → structure `overview` → `get_method_signature` → …). See MCP server instructions in [src/mcp.ts](src/mcp.ts).

#### 8.1.3 `diagnostics` subcommand

Developer-facing commands over structured logs (**§6.3**) — list recent failures, print one record, filter by severity, prune old files — without **`grep`** or manual NDJSON parsing.

```bash
# Recent failures, newest first
jvmsrc diagnostics list

# Full JSON record for one id (matches diagnostics/<id>.json when written)
jvmsrc diagnostics show a3f5c8d2

# Filter
jvmsrc diagnostics list --severity internal

# Prune
jvmsrc diagnostics clear --older-than 7d
```

Example **`list`** line shape (illustrative): timestamp, **`severity`**, **`errorCode`**, short **`id`**, **`operation`**.

### 8.2 MCP Server

The same core logic is exposed as an MCP server, making the tool available to IDE-integrated agents (Claude Desktop, Cursor, Windsurf, Cline) without shell invocation overhead. The published entry point is **`dist/mcp.js`** (run via `jvmsrc mcp` after install, or `bun run dev:mcp` in this repository).

```json
{
  "mcpServers": {
    "jvmsrc": {
      "command": "npx",
      "args": ["-y", "jvmsrc", "mcp"]
    }
  }
}
```

**Exposed MCP tools:**

Primary intent for **`get_method_signature`** / **`get_class_structure`**: **IDE-like** browsing (§7.2)—sources first, **`javap`** as fallback and for inheritance when bytecode exists—not wholesale duplication of every **`javap -verbose`** feature in the default contract.

| Tool | Status | Description |
|---|---|---|
| `find_in_class_source` | **Implemented** | Resolves source for **`className`** (same classpath path as **`get_class_source`**), then searches for **`query`** (literal substring by default; optional **`regex: true`**). Optional **`contextLines`** (default 3, max 50), **`maxHits`** (default 20, max 100). **Found:** **`isError: false`**, **`found: true`**, **`hits[]`** with **`line`**, **`column`**, **`matchedText`**, optional **`block`** (`startLine`–`endLine`), **`contextBefore`** / **`contextAfter`**, **`provenance`**, **`lineNumbersReliable`** (false when decompiled). **No matches (class resolved):** **`found: false`**, **`querySucceeded: true`**. **Class absent:** same as **`get_class_source`** (**`CLASS_NOT_FOUND`**). CLI: **`jvmsrc find-in-class <className> <query>`**. |
| `get_class_source` | **Implemented** | Returns Java source (original **`interproject`** / **sources JAR** or CFR-decompiled bytecode) for a **fully-qualified** class name. Tool arguments: **`className`**, **`projectRoot`**, optional **`modulePath`**, **`configuration`**, **`includeTest`**, **`forceRefresh`** (same semantics as CLI `get`). Optional excerpt: **`methodNames`** (array; use **`<init>`** for constructors; all overloads included) and/or **`methodName`** (merged into **`methodNames`**) and/or **`startLine`** / **`endLine`** (1-based inclusive; both required for line slices). Omit excerpt params for the full compilation unit. **Found:** **`isError: false`**, **`found: true`**, **`source`**, **`sourceAvailable`**, **`provenance`**, optional **`excerpt`** metadata (`matchedMethodNames`, `unmatchedMethodNames`, `lineNumbersReliable` — **`false`** when **`sourceAvailable: false`**). **Not on classpath (successful scan):** **`isError: false`**, **`found: false`**, **`querySucceeded: true`** — do not retry as a transient failure. **Failures:** **`isError: true`** with **`errorCategory`**, **`isRetryable`**, **`description`**, stable **`code`** (§7), and domain **`error`** (including **`EXCERPT_*`** for bad or unmatched excerpt requests). |
| `get_method_signature` | **Implemented** | **Overload listing** (§7.2). **Default:** **source-first** classpath **`.java`** when parseable; else **`javap -private -verbose`**. Optional **`bytecodeOnly: true`**: **javap only** (no sources/**`src/`** fallback); **`sourceAvailable`** always **`false`**. Arguments: **`className`**, **`methodName`**, **`projectRoot`**, optional **`modulePath`**, **`configuration`**, **`includeTest`**, **`forceRefresh`**, **`bytecodeOnly`**. **`JVMSRC_JAVAP_*`** env (§6.2). |
| `get_class_structure` | **Implemented** | **IDE-shaped API browse** (§7.2). **Default compact:** plain text; optional **`scope`**: `overview` \| `declared` \| `effective` (declaration-line method lists). **`full: true`:** JSON as below. Optional **`include`**: **`hierarchy`**, **`fields`**, **`annotations`** (primarily with full JSON). Does not run CFR. **`sourceAvailable`** when primary type came from original source. |
| `search_classes` | **Implemented** (index v3) | **Classpath discovery** when the FQN is unknown (§12.3). Arguments: **`query`** (non-empty), **`projectRoot`**, optional **`modulePath`**, **`configuration`**, **`includeTest`**, **`forceRefresh`**, **`limit`** (default 50, max 200). Resolves or loads cached Gradle output, builds or reuses **`class-search-index.json`** in the resolution cache bucket (with **`jar-fqn-cache.json`** stat-based reuse for unchanged JAR paths). Returns ranked hits: **`className`**, **`simpleName`**, **`moduleName`**, **`configurationName`**, **`origin`** (`external` \| `interproject` \| `local-file`), **`coordinates`**, **`jarPath`** / **`moduleRoot`** / **`interprojectModuleName`**, **`score`**. **Substring query:** case-insensitive match over index **`searchText`**: FQN and simple name, plus when sources are available declared method/field identifiers and plain text from Javadoc comments (`/** … */`) parsed from inter-project **`src/...`** **`.java`** and from external **`-sources.jar`** entries when **`sourcesJarPath`** on the artifact is non-null (index build does **not** call Gradle on-demand source resolution). **Glob query:** **`*`** / **`?`** apply to **FQN and simple name only** (not to enriched text). **Index:** external and **`local-file`** JAR **`.class`** names (ZIP central directory) plus source enrichment as above; inter-project **`src/main/java`** and **`src/test/java`** when **`includeTest`**. **`indexMeta`:** **`indexFormatVersion`** 3, **`sourceEnrichedEntries`**, **`sourceEnrichmentBytesCap`**, **`skippedArtifacts`**, etc. **Success:** **`isError: false`**, **`ok: true`**, **`querySucceeded: true`**, **`totalMatches`**, **`hitCount`**, **`hits[]`**, **`indexMeta`**. **Failures:** same envelope as **`resolve_dependencies`** or validation (**`MODULE_NOT_FOUND`**, **`CONFIGURATION_NOT_FOUND`**). |
| `resolve_dependencies` | **Implemented** | Returns validated **`ResolutionOutput`** (§5.5.2) for the whole project (all `modules[]`). Tool arguments: **`projectRoot`**, optional **`forceRefresh`** (same semantics as CLI `resolve` / §6.1). **Success:** **`isError: false`**, **`ok: true`**, **`resolution`** (full document). **Failures:** **`isError: true`** with **`errorCategory`**, **`isRetryable`**, **`description`**, **`code: RESOLUTION_FAILED`**, and domain **`error`**. Use before batch **`get_class_source`** calls to warm the resolution cache without per-class Gradle runs. |

**Failure diagnostics:** tool error payloads **may** include **`diagnosticId`** and **`hint`** (e.g. **`jvmsrc diagnostics show …`**) when a full diagnostic file is written, so agents can surface an opaque id to the developer without embedding subprocess output.

**MCP error categories (`get_class_source`, **`get_class_structure`**, **`get_method_signature`**, **`resolve_dependencies`**, **`search_classes`**, **`find_in_class_source`**):** Tool failures set **`isError: true`** and include **`errorCategory`**, **`isRetryable`**, and a **`description`** explaining what failed and why. **`transient`** — Gradle/network/timeouts, CFR timeouts, **javap** timeouts / spawn issues; retry after a delay. **`validation`** — bad `projectRoot`, FQN, **`methodName`**, `modulePath`, or `configuration`; fix inputs. **`business`** — e.g. CFR cannot decompile, sources permanently unavailable, **javap** exited non-zero without transient hints; do not retry the same request. **`permission`** — repository auth denied; escalate credentials. A class missing after a **successful** classpath scan is **`found: false`** with **`isError: false`** (not confused with “could not reach Gradle”). For **`get_method_signature`**, when the class is found but **`methodFound: false`**, the tool still returns **`isError: false`** — adjust **`methodName`** (constructors **`<init>`**) or inspect declarations via **`get_class_source`** or **`get_class_structure`**.

**`get_class_structure` output shape (illustrative):**

Optional tool argument **`include`**: string array of **`hierarchy`**, **`fields`**, **`annotations`** (any subset). **`hierarchy`** adds **`typeHierarchy.superclassChain`** (primary type → … → below **`java.lang.Object`**) and **`typeHierarchy.allSuperinterfaces`** (depth-first expansion of interface graphs). **`annotations`** adds **`classAnnotations`** plus per-declared-member **`annotations[].summary`** strings from **`javap -verbose`** `RuntimeVisibleAnnotations` (parameter-level annotations are not surfaced yet). Omitting **`fields`** in **`include`** yields **`fields: []`** for payload projection; omitting **`include`** entirely keeps the legacy default (**`fields`** populated, no hierarchy or annotation extras).

```typescript
// Tool: get_class_structure — success structuredContent (representative fields)
{
  "ok": true,
  "found": true,
  "querySucceeded": true,
  "className": "org.springframework.data.jpa.repository.JpaRepository",
  "kind": "interface",
  "superclass": "org.springframework.data.repository.PagingAndSortingRepository",
  "interfaces": ["org.springframework.data.repository.CrudRepository"],
  "typeParameters": ["T", "ID"],
  "fields": [],
  "methods": [
    {
      "name": "saveAll",
      "jvmMethodName": "saveAll",
      "declaringClass": "org.springframework.data.jpa.repository.JpaRepository",
      "visibility": "public",
      "returnType": "List<S>",
      "parameters": [{ "name": "entities", "type": "Iterable<S>" }],
      "typeParameters": [],
      "javadoc": "Saves all given entities...",
      "abstract": true,
      "static": false,
      "throws": [],
      "genericSignature": null,
      "jvmDescriptor": "(Ljava/lang/Iterable;)Ljava/util/List;",
      "inherited": false
    }
  ],
  "sourceAvailable": true,
  "provenance": { "kind": "classpathJar", "coordinates": { "group": "…", "name": "…", "version": "…" }, "jarPath": "/path/to/library.jar" }
}
```

When **`sourceAvailable`** is **`true`** from parsed **`.java`**, **declared** (**`inherited: false`**) methods in MCP responses may use **`jvmDescriptor`: `null`** (internal **`#SRC:`** merge keys are stripped). The example above shows a **javap-backed** declared member shape when bytecode metadata is used for the primary type.

**`get_method_signature` success payload (illustrative):**

```typescript
// Tool: get_method_signature
// Input: className, methodName, projectRoot, modulePath?, configuration?, includeTest?, forceRefresh?
{
  "ok": true,
  "found": true,
  "querySucceeded": true,
  "className": "java.io.Closeable",
  "methodName": "close",
  "methodFound": true,
  "sourceAvailable": false,
  "overloads": [
    {
      "declarationLine": "public abstract void close() throws java.io.IOException;",
      "visibility": "public",
      "jvmDescriptor": "()V",
      "genericSignature": null,
      "returnTypeDisplay": "void",
      "parameters": [],
      "thrownExceptions": ["java.io.IOException"],
      "flagsLine": "(0x0401) ACC_PUBLIC, ACC_ABSTRACT"
    }
  ],
  "provenance": {
    "kind": "classpathJar",
    "coordinates": { "group": "…", "name": "…", "version": "…" },
    "jarPath": "/path/to/library.jar"
  }
}
```

When **`sourceAvailable`** is **`true`** (overloads from parsed **`.java`**), MCP objects typically omit **`flagsLine`**, **`jvmDescriptor`**, and **`genericSignature`** unless a non-synthetic descriptor is available — declaration lines, **`visibility`**, **`returnTypeDisplay`**, **`parameters`**, and **`thrownExceptions`** carry the IDE-shaped contract.

**`get_class_structure`:** `kind` is one of: `class` \| `interface` \| `enum` \| `annotation` \| `record`. **`sourceAvailable`** mirrors §7.1 for the **primary** type: `true` when declared members (and Javadoc on those entries) come from a **sources JAR**; `false` when the primary type was not loaded from sources (structure is still useful from **`javap`**). Inherited entries in **`methods`** are bytecode-derived and marked with **`inherited: true`**. **`javadoc`** may be `null` when sources were not used for that entry.

**Implementation note:** The primary type uses **`javap`** plus an optional **sources JAR** read (same on-demand Gradle path as `get`) for Javadoc on **declared** members; supertypes use **`javap`** only. **CFR** is not used for this tool.

### 8.3 Dual-Entry Architecture

Both interfaces are thin wrappers over the same TypeScript module. The core logic is importable as a library for agents that prefer native function calls over shell or MCP:

```typescript
import { getClassSource, getClassStructure } from 'jvmsrc';

const r = await getClassSource('com.example.MyClass', {
  projectRoot: '/path/to/project',
  modulePath: ':core:utils',
});
if (r.ok) {
  const { source, sourceAvailable, provenance } = r;
} else {
  // r.error.code — see §7 stable codes
}

const s = await getClassStructure('com.example.MyClass', {
  projectRoot: '/path/to/project',
  include: ['hierarchy', 'annotations'],
});
if (s.ok) {
  const { methods, fields, sourceAvailable } = s;
} else {
  // s.error.code
}
```

---

## 9. Packaging & Distribution

### 9.1 NPM Package

The package bundles all auxiliary files so the tool works offline immediately after installation:

```
package.json           ← bin: { "jvmsrc": "./dist/cli.js" }; main + exports → dist/public-api.js
dist/
  cli.js               ← compiled CLI entry point
  mcp.js               ← compiled MCP server entry point
  public-api.js        ← compiled library entry (getClassSource, types, …)
  *.js                 ← compiled core modules
resources/
  cfr.jar              ← bundled CFR decompiler
  analyzer-init.gradle ← bundled Gradle init script
```

The `files` array in `package.json` ensures `resources/` is included in the published tarball. **`bun run prepack`** runs typecheck, build, and [`scripts/validate-bundled-resources.ts`](scripts/validate-bundled-resources.ts) (minimum sizes for `cfr.jar` and `analyzer-init.gradle`). Bundled resource paths are resolved from the **package root** (nearest `package.json` with `name: "jvmsrc"`), not from the caller’s working directory, so `dist/` layout changes do not break resolution.

### 9.2 Runtime Resource Resolution

```typescript
type BundledResourceName = 'cfr.jar' | 'analyzer-init.gradle';

function getBundledResource(filename: BundledResourceName): string {
  const resourcePath = path.join(packageRoot, 'resources', filename);
  if (!fs.existsSync(resourcePath)) {
    throw new Error(
      `Bundled resource '${filename}' not found at ${resourcePath}. ` +
      `The package may be corrupted. Try reinstalling.`
    );
  }
  return resourcePath;
}

// CFR JAR selection (implementation: `resolveCfrJarPath()` in `src/decompiler/resolve-cfr-jar.ts`):
// `JVMSRC_CFR_PATH` → else `JVM_ORACLE_CFR_PATH` → else `getBundledResource('cfr.jar')`.
const INIT_SCRIPT_PATH     = getBundledResource('analyzer-init.gradle');
```

### 9.3 CFR path override

If the environment variable **`JVMSRC_CFR_PATH`** is set to an absolute or relative path of a JAR file, the decompiler layer uses that JAR **instead of** the bundled `resources/cfr.jar`. Default remains the bundled artifact. Implementations may also honor legacy **`JVM_ORACLE_CFR_PATH`** when `JVMSRC_CFR_PATH` is unset.

**Why:** Some organizations block arbitrary bundled binaries until security review. Supplying an internally vetted CFR build keeps the tool usable without forking the package. When unset, behavior is unchanged.

### 9.4 Why NPM over a Native Binary

Compiling to a single native binary (via GraalVM or `pkg`) would require a cross-compilation matrix for Mac ARM, Mac Intel, Linux x86, and Linux ARM. Since the tool already requires a JVM to be present (to run Gradle and CFR), and LLM agent environments are heavily Node.js-based, NPM distribution provides equivalent single-command UX (`npx`) with none of the cross-compilation overhead.

---

## 10. Design Decisions & Rejected Alternatives

### Why resolve all configurations eagerly rather than on demand?

Gradle's dominant cost is startup and configuration — not dependency resolution itself. Once Gradle is running, resolving four configurations costs marginally more than resolving one. Resolving lazily (on demand, per scope) would mean potentially invoking Gradle multiple times per session: once when the agent asks about a compile-time class, again if it asks about a test dependency. Eager resolution pays the Gradle cost exactly once per cache miss, and the resulting output file covers every scope any subsequent call could need. The `configurations` array structure in the output format makes the scope selection a pure in-memory lookup with no I/O after the initial resolution.

### Why build-tool invocation instead of cache scanning?

Cache scanning (`~/.gradle/caches`) is faster but fundamentally unreliable. A machine with multiple Java projects will have multiple versions of common libraries. There is no metadata in the cache directory structure that associates a cached JAR with the specific project that declared it. For SNAPSHOT dependencies, dynamic versions (`2.+`), and BOM-managed versions, the correct version cannot be determined without running the build tool. Silently returning the wrong version is the worst possible failure mode for an agent — it receives plausible-looking but incorrect code.

### Why --init-script injection instead of a Gradle plugin?

A Gradle plugin would require the developer to add a `plugins {}` block to their `build.gradle` — violating the zero-project-modification requirement. An init script is injected entirely from the outside via `--init-script` and leaves no trace in the project. It works on any Gradle project regardless of its existing configuration.

### Why default to `compileClasspath` and not `runtimeClasspath`?

An LLM agent writing code needs to know what it can *import* — that is, what is visible at compile time. `runtimeClasspath` includes additional JARs (logging implementations, JDBC drivers, etc.) that cannot be imported directly. Defaulting to `compileClasspath` gives the agent the most accurate picture of the API surface it can use.

### Why prefer source JARs over decompilation?

Decompilation with CFR produces structurally correct Java but loses: Javadoc comments, parameter names (unless compiled with `-parameters`), and sometimes generic type information. Source JARs contain the original author intent, full documentation, and accurate signatures. The tool checks for a sources JAR first and only falls back to decompilation when none is available.

### Why bundle CFR instead of downloading it?

Downloading executables at runtime introduces failure modes (network outages, corporate firewalls, proxy configurations) and security concerns. Bundling CFR into the NPM package makes the tool strictly versioned, cryptographically verifiable via NPM package hashes, and fully offline-capable after installation.

### Why expose both CLI and MCP interfaces?

Different agent architectures have different needs. Terminal-native agents (Claude Code, shell-based pipelines) work most naturally with CLI tools — they avoid loading MCP tool schemas into the context window on every turn, which matters at scale. IDE-integrated agents (Cursor, Windsurf, Claude Desktop) benefit from persistent MCP server processes with warm caches and structured tool invocation. Both interfaces share identical core logic; the choice of surface is purely operational.

### Why add `get_class_structure` alongside `get_class_source`?

Most agent questions are about **signatures** (return type, parameters, implemented interfaces, visibility) — not 800 lines of implementation. Returning full source for every question wastes context and latency. `get_class_structure` mirrors the IDE pattern of “stub first, full file on demand”: a cheap structured call, then escalate to `get_class_source` only when the body matters.

### Why `forceRefresh` / `--force-refresh`?

Hash-based invalidation only sees **tracked build files**. It cannot see SNAPSHOT churn in a remote repo, manual Gradle cache wipes, or CI environments where resolved artifacts changed without editing `build.gradle`. A explicit bypass lets agents and humans re-resolve without deleting cache directories by hand.

### Why `sourceAvailable` on every source-bearing response?

Agents must treat **original source** and **decompiled bytecode** differently: parameter names and Javadoc are ground truth in the former and unreliable in the latter. A single boolean keeps that contract explicit in MCP, CLI, and library APIs (§7.1).

---

## 11. MVP Scope

**Implementation checklist and priorities:** [ROADMAP.md](ROADMAP.md) (developers: check boxes there when features land).

The following represents the minimum build that validates the architecture end-to-end:

1. `DependencyResolver` interface + `detectResolver()` registry
2. `GradleResolver` with init-script injection, JSON output, multimodule support
3. Hash-based resolution cache with invalidation on build file changes
4. Class-to-artifact lookup using the resolved tree
5. Source JAR extraction (preferred path)
6. CFR decompilation with result caching (fallback path)
7. CLI entry point with `--project` and `--module` flags
8. MCP server entry point; **`get_class_source`**, **`find_in_class_source`**, **`resolve_dependencies`**, **`search_classes`**, **`get_method_signature`** (optional **`bytecodeOnly`**), and **`get_class_structure`** are implemented (§8.2). **`origin: interproject`** classes load from depended **`src/...`** **`.java`** for **`get`** and for **source-first** structure/signature tools before falling back to **`javap`** on **`build/classes/**`** when needed. **`get_class_structure`** enriches declared members from that source when present; optional **`include`** slices (`hierarchy`, `fields`, `annotations`) are documented in §8.2.
9. Structured error responses (unsupported project, class not found, version conflict)

**Near-term interface goals** — priority order tracks **agent use-case frequency** (full breakdown in §12):

| Priority | Item | Section |
|---|---|---|
| High | `get_method_signature` / `get_method_signature_bytecode` MCP tools (IDE-first vs javap-only; §7.2) — **implemented** (§8.2) | §8.2, §12 |
| High | `get_class_structure` MCP tool (metadata; **inherited** API on the type) — **implemented** (§8.2) | §8.2, §12 |
| High | `sourceAvailable` on all source-bearing MCP/CLI/library responses | §7.1 |
| Medium | Enrich `get_class_structure` (optional `include`: hierarchy, fields, annotations) — **implemented** (§8.2); parameter-level annotations deferred | §12 |
| Medium | `forceRefresh` on `resolve_dependencies` + `--force-refresh` on CLI | §6.1, §8.1 — **done** for MCP and CLI |
| Medium | **`search_classes`** / class search index (capability discovery; index-backed) | §12 — **implemented** (§8.2 index v3: FQN + **`local-file`** JARs + source-derived method / field / Javadoc **`searchText`**; **`jar-fqn-cache.json`** reuse; globs still FQN/simple only) |
| Medium | Structured failure diagnostics + **`jvmsrc diagnostics`** CLI | §6.3, §8.1.3 |
| Low | `jvmsrc config` MCP snippet generator — **implemented** (§8.1.2) | §8.1.2 |
| Low | `JVMSRC_CFR_PATH` / `JVM_ORACLE_CFR_PATH` CFR JAR override — **implemented** | §9.3 |
| Future | `get_implementors` (inverted index; post–v2) | §12 |

Maven resolver is explicitly out of scope for v1 but the architecture accommodates it as a drop-in addition.

---

## 12. Future Work

### 12.1 Resolver and toolchain

| Item | Notes |
|---|---|
| `MavenResolver` | Parse `pom.xml`, invoke `mvn dependency:resolve`, same interface |
| `BazelResolver` | Use Bazel query API |
| Decompiler alternatives | Pluggable decompiler interface; allow Procyon or Fernflower as alternatives to CFR |

### 12.2 Agent use-case interface expansion

Analysis of how agents use JVM dependencies in practice suggests several query patterns. **`get_class_source`** alone covers a minority of calls; the items below expand MCP coverage. Priorities follow **estimated operation frequency** (not a promise of exact percentages).

#### P0 — include in MVP (see also §11)

| Tool / requirement | Approx. use-case share | Notes |
|---|---|---|
| **`get_method_signature` / `get_method_signature_bytecode`** | ~30% | **Shipped:** **`get_method_signature`** is overload metadata **source-first**, then **`javap -verbose`** when needed; **`get_method_signature_bytecode`** is **`javap`** only (no **`src/`** fallback) for JVM-descriptor workflows (§7.2, §8.2). |
| **`get_class_structure`** | ~20% | Browse API when the class is known; **includes inherited** public/protected instance methods (§8.2). |

#### P1 — first release after MVP

**Enrich `get_class_structure`** (~22% combined across three sub-cases) using **optional response sections** (e.g. `include: ['hierarchy', 'fields', 'annotations']`) so one parser backs one tool:

- **Type hierarchy** (~10%) — superclass and interfaces, recursively; substitutability checks.
- **Fields** (~8%) — names, types, visibility, `final`; for DTOs and construction.
- **Annotations** (~4%) — by target (class, method, field, parameter) with values; Spring, JPA, Jackson.

#### P2 — v2

| Item | Approx. share | Notes |
|---|---|---|
| **`search_classes(query)`** | ~7% | Capability discovery when FQN is unknown. **Shipped:** index format v2 adds **full-text** **`searchText`** from sources when available (methods, fields, Javadoc `/** */` from inter-project `.java` and from `-sources.jar` when `sourcesJarPath` is set), in addition to class names; substring queries use the full blob; globs still match FQN/simple name only. |
| **Enum constants** | ~2% | No new tool: when `kind === "enum"`, **`get_class_structure`** should expose constants in the fields array with Javadoc where available. |
| **Compact / full response modes** | — | **Shipped:** default **plain text**; MCP **`full: true`** / CLI **`--full`** for JSON. **`get_class_structure`** **`scope`** for discovery vs declared API ([ROADMAP](ROADMAP.md)). |

#### P3 — future / post–v2

| Item | Approx. share | Notes |
|---|---|---|
| **`get_implementors(interfaceName)`** | ~1% | Templates from existing implementations. Requires **inverted index** (interface → implementors) over resolved JARs; high cost, low frequency. Defer until simpler tools and adoption justify index maintenance. |

#### Internal architecture note

**Today:** **`get_method_signature`** and **`get_class_structure`** default to **IDE-like** behavior (§7.2): classpath-ordered **`.java`** plus **`parseJavaTypeMetadata`**, with **`javap -private -verbose`** when bytecode is needed or sources are missing. Default MCP payloads omit **`javap`**-oriented fields on source-derived rows where practical; full bytecode fidelity is available via **`get_method_signature_bytecode`**.

**Direction:** optional refactor — share one cached **`ClassStructure`**-style parse per class where worthwhile:

**Target (optional refactor):** projections over a single in-memory parse per class where it pays off:

```text
parse class (once, cached)
  └── ClassStructure
        ├── get_class_source       → full text (source JAR or CFR)
        ├── get_class_structure    → metadata (+ optional sections in P1)
        ├── get_method_signature   → one method slice (all overloads)
        ├── get_method_signature_bytecode → javap-only overload slice
        └── further projections
```

**`search_classes`** (P2) and **`get_implementors`** (P3) are **not** projections of one parse — they depend on **resolution-wide indexing** and dedicated index maintenance.

#### Coverage summary (illustrative)

| Tool | Role | Approx. ops covered | Target |
|---|---|---|---|
| `get_class_source` | Full source | ~15% | MVP (done) |
| `get_method_signature` | Method contract (IDE-first) | ~25% | MVP (**done** — source-first + javap fallback) |
| `get_method_signature_bytecode` | Method contract (javap-only) | ~5% | MVP (**done**) |
| `get_class_structure` (enriched over releases) | Browse API, hierarchy, fields, annotations | ~42% | MVP + P1 |
| `search_classes` | Discovery | ~7% | v3 (**done** — index v3 + JAR FQN sidecar cache) |
| `get_implementors` | Implementation templates | ~1% | Future |
| **Total** | | **~88%** | |

### 12.3 Class search and disambiguation (index)

| Item | Notes |
|---|---|
| Class search by simple name or glob | Accept `MyClass`, `com.foo.*Bar`, or `*Repository` in addition to FQN; resolve against an index built from `ResolutionOutput` + classpath scan; return **ranked candidates** (FQN, module, artifact coordinates). Evolves toward **`search_classes`** (§12.2 P2) when full-text / Javadoc indexing lands. Medium effort, medium impact on autonomy. |

### 12.4 Failure diagnostics (operator UX)

**Implemented:** structured diagnostic logging (**§6.3**) plus **`jvmsrc diagnostics`** (**§8.1.3**) so operators can inspect Gradle/CFR/environment issues from retained subprocess tails and context without burdening agents. See **[ROADMAP.md](ROADMAP.md)** P1 — failure diagnostics.

