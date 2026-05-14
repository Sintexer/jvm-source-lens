# JVM Class Oracle — Technical Specification
**Version 2.0 · Extensible Multi-Build-System Architecture**

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

All resolver plugins implement the following contract. Resolution produces a **`ResolutionOutput`** document (stdout from Gradle today, and the same object persisted under `.jvm-oracle-cache/resolution.json` — see §5.5.2). The extractor chooses one `ResolvedConfiguration` per call using `ResolveOptions` (`configuration`, `includeTest`, `modulePath`); it does not re-invoke Gradle.

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
    index.ts              ← JAR extraction, source-preference logic
  decompiler/
    index.ts              ← CFR subprocess wrapper
  cache/
    index.ts              ← resolution cache with hash-based invalidation
  cli.ts                  ← CLI entry point
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

The Node implementation prefers **`./gradlew`** when present (correct Gradle version for the repo), otherwise **`gradle`** on `PATH`. It passes **`-PjvmOracleWrapper=true|false`** so the emitted JSON records whether the wrapper was used (`buildSystem.wrapper`).

**Configuration cache:** v1 always passes **`--no-configuration-cache`**. The bundled task resolves every submodule in one root task that walks `allprojects` at execution time; that pattern is incompatible with Gradle’s configuration cache until a future redesign (e.g. per-project tasks). Real-world projects with configuration cache enabled in `gradle.properties` still work because this flag disables CC for this invocation only.

```typescript
const useWrapper = fs.existsSync(path.join(projectRoot, 'gradlew'));
const initScript = getBundledResource('analyzer-init.gradle'); // package-root absolute path

const argv = [
  ...(useWrapper ? [path.join(projectRoot, 'gradlew')] : ['gradle']),
  `-PjvmOracleWrapper=${useWrapper}`,
  '--no-configuration-cache',
  '--init-script',
  initScript,
  '--quiet',
  'jvmOracleResolve',
];

const proc = Bun.spawn(argv, { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
// await streams + exit code → parse stdout JSON → validate schemaVersion → ResolutionResult
```

### 5.3 Init Script Contract

The bundled `analyzer-init.gradle` registers a **single root task** named `jvmOracleResolve` from `gradle.projectsLoaded`. Running that task walks **all** Gradle subprojects once and prints **one** JSON document to stdout (the `ResolutionOutput` in §5.5.2). The Node side parses that single blob; there is no merge step for multiple per-project prints.

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
jvm-dependency-resolver get com.example.MyClass --project /path/to/project

# Resolves against a specific submodule
jvm-dependency-resolver get com.example.MyClass --project /path/to/project --module :core:utils
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
  schemaVersion: string;            // e.g. "1.0" — bump on breaking changes
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
  jarPath: string | null;           // null for interproject deps
  sourcesJarPath: string | null;    // null = checked and absent, not = field omitted
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
  "schemaVersion": "1.0",
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
| `sourcesJarPath: null` | On `compileClasspath` (and similar), Gradle usually resolves the main artifact only — **sources classifiers are often absent**, so `null` is expected unless the build adds sources or a separate resolution path. A future schema revision may add an explicit `sourcesResolvable` hint and on-demand Gradle steps. |
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

## 6. Caching Strategy

### 6.1 Resolution Cache

Gradle invocation is expensive (1–10 seconds). The tool caches the full **`ResolutionOutput`** JSON (same structure as §5.5.2 / Gradle stdout) and invalidates it only when build files change.

**Cache key:** SHA-256 hash of all build-relevant files in the project:
- `build.gradle` / `build.gradle.kts` (all subprojects)
- `settings.gradle` / `settings.gradle.kts`
- `gradle/libs.versions.toml` (version catalog, if present)
- `gradle/dependency-locks/*.lockfile` (if present)

**Cache location:** `<projectRoot>/.jvm-oracle-cache/resolution.json` — the one directory the tool does write, but inside the project's own cache space, not modifying any build files.

When the hash matches, the cached document is used immediately. When it differs, Gradle is re-invoked and the cache is refreshed.

**Escape hatch — `forceRefresh`:** Hash keys only cover tracked build inputs (`build.gradle*`, `settings.gradle*`, version catalogs, lockfiles). They do **not** detect SNAPSHOT bumps in a remote repo, a teammate clearing `~/.gradle`, or CI using a fresh dependency cache while build files are unchanged. **`resolve_dependencies`** (MCP) and **`--force-refresh`** (CLI) bypass the resolution cache and **always** re-invoke Gradle so the agent or developer can say “artifacts changed; re-resolve anyway” without manually deleting `.jvm-oracle-cache/`.

### 6.2 Decompilation Cache

CFR decompilation results are cached by artifact coordinates + class name:

```
<projectRoot>/.jvm-oracle-cache/decompiled/<group>/<artifact>/<version>/<ClassName>.java
```

This means sequential agent calls for classes within the same dependency pay the decompilation cost only once.

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

The tool **never falls back to scanning the global cache** without a resolved tree. If Gradle resolution fails, the tool reports the failure — it does not attempt to guess from `~/.gradle/caches`.

### 7.1 `sourceAvailable` on source-bearing responses

Every response that returns **Java source text** (CLI `get` stdout, MCP `get_class_source`, and any library API that returns a source string) includes a boolean **`sourceAvailable`** (or equivalent field in the structured envelope):

- **`true`** — text came from **original source** (project sources, inter-project files, or a **sources JAR**). Javadoc, parameter names (as compiled), and generics match what the author shipped.
- **`false`** — text came from **decompiled bytecode** (CFR). Structurally reliable, but Javadoc is absent, parameter names may be missing unless the dependency was built with `-parameters`, and complex generics can be approximated.

Agents should treat `sourceAvailable: false` as “trust types and control flow; treat names and comments as best-effort.” Escalation to `get_class_structure` (signatures only) or re-resolution (`forceRefresh`) is a separate concern.

---

## 8. Interface Layer

### 8.1 CLI

```bash
# Install globally
npm install -g jvm-dependency-resolver

# Or run without installation
npx jvm-dependency-resolver get com.example.MyClass

# With options
jvm-dependency-resolver get com.example.MyClass \
  --project /path/to/project \
  --module :core:utils \
  --configuration compileClasspath \
  --include-test

# Bypass resolution cache (hash unchanged but artifacts on disk changed — e.g. SNAPSHOT,
# manual ~/.gradle cleanup, CI cold cache). Re-invokes Gradle unconditionally.
jvm-dependency-resolver get com.example.MyClass --project /path/to/project --force-refresh
```

Output is the Java source code on `stdout` together with metadata (including **`sourceAvailable`**, see §7.1). Errors go to `stderr` with a non-zero exit code, making the tool composable in shell pipelines and agent tool calls.

#### 8.1.1 `config` subcommand (planned)

A **`jvm-dependency-resolver config`** command inspects the environment (build system markers, `JAVA_HOME` / detected JDK) and prints a **ready-to-paste** MCP server block for the user’s IDE (Claude Desktop, Cursor, Windsurf). Optional: copy to clipboard when supported.

Goals: remove hand-edited JSON mistakes (`command`, `args`, `env`) and improve first-run success rate. Low implementation cost, high UX leverage (same idea as dedicated MCP config-generator utilities in other ecosystems).

### 8.2 MCP Server

The same core logic is exposed as an MCP server, making the tool available to IDE-integrated agents (Claude Desktop, Cursor, Windsurf, Cline) without shell invocation overhead.

```json
{
  "mcpServers": {
    "jvm-dependency-resolver": {
      "command": "npx",
      "args": ["-y", "jvm-dependency-resolver", "mcp"]
    }
  }
}
```

**Exposed MCP tools:**

| Tool | Description |
|---|---|
| `get_class_source` | Returns full Java source (original or CFR-decompiled) for a **fully-qualified** class name; response includes **`sourceAvailable`** (§7.1). |
| `get_class_structure` | Returns **structured metadata only** — kind, superclass, interfaces, type parameters, fields (type + visibility), method signatures (parameters, return type, generics), Javadoc when a sources JAR exists — **not** full file body. Lets agents answer “does this method take `String` or `CharSequence`?” without burning context on hundreds of lines; escalate to `get_class_source` when implementation is needed. |
| `list_modules` | Lists all submodules in a multimodule project with their dependency counts |
| `resolve_dependencies` | Returns **`ResolutionOutput`** (§5.5.2) for the project or scoped module. Supports **`forceRefresh: boolean`** — when `true`, skips hash-based resolution cache and re-invokes Gradle (see §6.1). |

**`get_class_structure` output shape (illustrative):**

```typescript
// Tool: get_class_structure
// Input: className (FQN), projectRoot, modulePath?
{
  "className": "org.springframework.data.jpa.repository.JpaRepository",
  "kind": "interface",
  "superclass": "org.springframework.data.repository.PagingAndSortingRepository",
  "interfaces": ["org.springframework.data.repository.CrudRepository"],
  "typeParameters": ["T", "ID"],
  "fields": [],
  "methods": [
    {
      "name": "saveAll",
      "visibility": "public",
      "returnType": "List<S>",
      "parameters": [{ "name": "entities", "type": "Iterable<S>" }],
      "typeParameters": ["S extends T"],
      "javadoc": "Saves all given entities...",
      "abstract": true
    }
  ],
  "sourceAvailable": true
}
```

`kind` is one of: `class` \| `interface` \| `enum` \| `annotation` \| `record`. **`sourceAvailable`** mirrors §7.1: `true` when Javadoc / parameter names in the structure come from real sources; `false` when derived from decompiled bytecode (structure still useful, prose less trustworthy). **`javadoc`** may be `null` when no sources JAR is available.

**Implementation note:** Structure can be produced by parsing `.java` from a sources JAR, by analyzing `.class` bytes (e.g. ASM or similar bytecode libraries), or by consuming CFR output in a structured pipeline — without returning the full source file to the client.

### 8.3 Dual-Entry Architecture

Both interfaces are thin wrappers over the same TypeScript module. The core logic is importable as a library for agents that prefer native function calls over shell or MCP:

```typescript
import { getClassSource } from 'jvm-dependency-resolver';

// Library return type includes provenance (exact shape TBD; mirrors §7.1)
const { source, sourceAvailable } = await getClassSource('com.example.MyClass', {
  projectRoot: '/path/to/project',
  modulePath: ':core:utils',
});
```

---

## 9. Packaging & Distribution

### 9.1 NPM Package

The package bundles all auxiliary files so the tool works offline immediately after installation:

```
package.json           ← bin: { "jvm-dependency-resolver": "./dist/cli.js" }
dist/
  cli.js               ← compiled CLI entry point
  mcp.js               ← compiled MCP server entry point
  *.js                 ← compiled core modules
resources/
  cfr.jar              ← bundled CFR decompiler
  analyzer-init.gradle ← bundled Gradle init script
```

The `files` array in `package.json` ensures `resources/` is included in the published tarball. **`bun run prepack`** runs typecheck, build, and [`scripts/validate-bundled-resources.ts`](scripts/validate-bundled-resources.ts) (minimum sizes for `cfr.jar` and `analyzer-init.gradle`). Bundled resource paths are resolved from the **package root** (nearest `package.json` with `name: "jvm-dependency-resolver"`), not from the caller’s working directory, so `dist/` layout changes do not break resolution.

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

const CFR_JAR_PATH =
  process.env.JVM_ORACLE_CFR_PATH?.trim() || getBundledResource('cfr.jar');
const INIT_SCRIPT_PATH     = getBundledResource('analyzer-init.gradle');
```

### 9.3 CFR path override

If the environment variable **`JVM_ORACLE_CFR_PATH`** is set to an absolute or relative path of a JAR file, the decompiler layer uses that JAR **instead of** the bundled `resources/cfr.jar`. Default remains the bundled artifact.

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

The following represents the minimum build that validates the architecture end-to-end:

1. `DependencyResolver` interface + `detectResolver()` registry
2. `GradleResolver` with init-script injection, JSON output, multimodule support
3. Hash-based resolution cache with invalidation on build file changes
4. Class-to-artifact lookup using the resolved tree
5. Source JAR extraction (preferred path)
6. CFR decompilation with result caching (fallback path)
7. CLI entry point with `--project` and `--module` flags
8. MCP server entry point with `get_class_source`, `get_class_structure`, `list_modules`, `resolve_dependencies` tools (see §8.2 for shapes and flags)
9. Structured error responses (unsupported project, class not found, version conflict)

**Near-term interface goals (specified in §7–§9; implement in priority order):**

| Priority | Item | Section |
|---|---|---|
| High | `get_class_structure` MCP tool (metadata without full source) | §8.2 |
| High | `sourceAvailable` on all source-bearing MCP/CLI/library responses | §7.1 |
| Medium | `forceRefresh` on `resolve_dependencies` + `--force-refresh` on CLI | §6.1, §8.1 |
| Medium | Class search by simple name / glob (disambiguation list) | §12 |
| Low | `jvm-dependency-resolver config` MCP snippet generator | §8.1.1 |
| Low | `JVM_ORACLE_CFR_PATH` CFR JAR override | §9.3 |

Maven resolver is explicitly out of scope for v1 but the architecture accommodates it as a drop-in addition.

---

## 12. Future Work

| Item | Notes |
|---|---|
| `MavenResolver` | Parse `pom.xml`, invoke `mvn dependency:resolve`, same interface |
| `BazelResolver` | Use Bazel query API |
| Decompiler alternatives | Pluggable decompiler interface; allow Procyon or Fernflower as alternatives to CFR |
| Class search by simple name or glob | Accept `MyClass`, `com.foo.*Bar`, or `*Repository` in addition to FQN; resolve against an index built from `ResolutionOutput` + classpath scan; return **ranked candidates** (FQN, module, artifact coordinates) for the agent to choose or disambiguate. Moves from “exact FQN or fail” to “best effort with disambiguation” for stack traces and partial snippets. Medium effort, medium impact on autonomy. |
