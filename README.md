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
- Resolve the correct artifact version by querying the project's actual build tool — never by guessing from cache.
- Support multimodule projects; resolve dependencies **per submodule** when a module path is specified.
- Prefer original **source JARs** over decompilation when available.
- **Decompile bytecode automatically** (via bundled CFR) when no source JAR is available.
- Recognize **inter-project dependencies** in multimodule builds and return source file paths rather than decompiling own-project classes.
- Support Gradle projects at launch; be architected to add Maven, Bazel, and other resolvers without modifying core logic.
- Reject unsupported project types with a clear, actionable error message.

### 3.2 Non-Functional

- **Zero project modification:** no files written to the target project directory.
- **Low latency for sequential calls:** build-tool resolution runs once per session; results are cached until build files change (hash-based invalidation).
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
                        │  ResolvedDependencyTree
┌───────────────────────▼─────────────────────────────────┐
│            Extractor + Decompiler Layer                  │
│   JAR lookup → source JAR preference → CFR fallback     │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Core Interfaces (TypeScript)

All resolver plugins implement the following contract. The downstream extraction layer depends only on `ResolvedArtifact` — it has zero knowledge of build systems.

```typescript
interface DependencyResolver {
  // Returns true if this resolver can handle the given project root
  detect(projectRoot: string): boolean;

  // Resolves the full dependency tree for the project
  resolve(projectRoot: string, options?: ResolveOptions): Promise<ResolvedDependencyTree>;
}

interface ResolveOptions {
  modulePath?:    string;   // e.g. ':core:utils' — scope to one submodule
  configuration?: string;   // e.g. 'compileClasspath' (default)
  includeTest?:   boolean;  // include test-scoped deps (default: false)
}

interface ResolvedDependencyTree {
  modules: ProjectModule[];
}

interface ProjectModule {
  name:      string;            // e.g. ':app', ':core:utils', 'root'
  path:      string;            // absolute filesystem path
  artifacts: ResolvedArtifact[];
}

interface ResolvedArtifact {
  group:           string;
  name:            string;
  version:         string;      // always the resolved version, not declared
  jarPath:         string;      // absolute path to classes JAR
  sourcesJarPath?: string;      // absolute path to sources JAR, if available
  scope:           'compile' | 'runtime' | 'test' | 'provided';
}
```

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
src/
  resolvers/
    index.ts              ← registry + detectResolver()
    base.ts               ← DependencyResolver interface + shared types
    gradle/
      index.ts            ← GradleResolver implementation
      analyzer-init.gradle  ← bundled init script (injected at runtime)
    maven/                ← future
      index.ts
  extractor/
    index.ts              ← JAR extraction, source-preference logic
  decompiler/
    index.ts              ← CFR subprocess wrapper
    cfr.jar               ← bundled decompiler binary
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

Resolution is performed by injecting a bundled Gradle init script at invocation time using the `--init-script` flag. This requires **zero project modification** and works regardless of the project's own Gradle configuration.

```typescript
// Prefer the project's own wrapper for version correctness
const gradleCmd = fs.existsSync(path.join(projectRoot, 'gradlew'))
  ? './gradlew'
  : 'gradle';

const result = execSync(
  `${gradleCmd} jvmOracleResolve --init-script "${INIT_SCRIPT_PATH}" --quiet`,
  { cwd: projectRoot, encoding: 'utf-8' }
);

const tree: ResolvedDependencyTree = JSON.parse(result);
```

### 5.3 Init Script Contract

The bundled `analyzer-init.gradle` registers a task `jvmOracleResolve` on every subproject. When executed, each subproject emits a JSON blob to stdout describing its resolved artifacts. The Node process collects and merges these into a single `ResolvedDependencyTree`.

**Critical design decisions baked into the init script:**

- **Targets `compileClasspath` by default.** This is what the compiler sees — it is the most semantically meaningful configuration for an agent writing code. `runtimeClasspath` adds artifacts the agent cannot actually import.
- **Outputs resolved versions, not declared versions.** When Gradle resolves a version conflict (e.g., `1.0` declared but `2.1` selected via conflict resolution), the output reflects `2.1` — what is actually on the classpath.
- **Enumerates all subprojects independently.** Each subproject's configuration is resolved separately, enabling per-module queries.
- **Recognizes inter-project dependencies.** `project(':core')` references are emitted as source pointers (absolute path to the subproject root), not as JARs.
- **Suppresses all Gradle output except the JSON blob** using `--quiet` and `println` only for the structured result.

### 5.4 Multimodule Handling

For a multimodule Gradle project, the tool resolves and indexes all submodules in one Gradle invocation. The caller may then scope a class lookup to a specific module:

```bash
# Resolves against the root project (union of all modules)
jvm-class-oracle com.example.MyClass --project /path/to/project

# Resolves against a specific submodule
jvm-class-oracle com.example.MyClass --project /path/to/project --module :core:utils
```

When `--module` is omitted on a multimodule project, the tool uses the union of all modules' resolved artifacts. If the same class exists in multiple modules with different versions, the tool surfaces the conflict explicitly rather than picking silently.

## Section 5.4 — Resolution Output Format (new, insert after 5.3)

### 5.4.1 Eager Multi-Scope Resolution

The init script resolves **all configurations for every submodule in a single Gradle invocation**. This is a deliberate performance trade-off: Gradle's startup and configuration cost is paid once, and the resulting cache file is complete regardless of which configuration the caller later queries. Subsequent class lookups — regardless of scope — always hit the in-memory or disk cache rather than re-invoking Gradle.

Configurations resolved per module:

- `compileClasspath` — what the compiler sees; the primary scope for agent code writing
- `runtimeClasspath` — adds runtime-only artifacts (drivers, logging impls, etc.)
- `testCompileClasspath` — compile-time additions for test sources
- `testRuntimeClasspath` — full classpath available during test execution

Any configuration that cannot be resolved (e.g. does not exist in a given submodule) is silently skipped rather than treated as an error.

### 5.4.2 JSON Schema

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

### 5.4.3 Canonical Example

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

### 5.4.4 Field Rationale

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
| `sourcesJarPath: null` | Means "checked and absent" — distinct from the field being omitted, which would mean "not checked" |
| `errors` always present | Partial resolution failures (one unreachable submodule) should not discard results for the rest; non-empty errors array does not mean the output is unusable |


## 6. Caching Strategy

### 6.1 Resolution Cache

Gradle invocation is expensive (1–10 seconds). The tool caches the `ResolvedDependencyTree` and invalidates it only when build files change.

**Cache key:** SHA-256 hash of all build-relevant files in the project:
- `build.gradle` / `build.gradle.kts` (all subprojects)
- `settings.gradle` / `settings.gradle.kts`
- `gradle/libs.versions.toml` (version catalog, if present)
- `gradle/dependency-locks/*.lockfile` (if present)

**Cache location:** `<projectRoot>/.jvm-oracle-cache/resolution.json` — the one directory the tool does write, but inside the project's own cache space, not modifying any build files.

When the hash matches, the cached tree is used immediately. When it differs, Gradle is re-invoked and the cache is refreshed.

### 6.2 Decompilation Cache

CFR decompilation results are cached by artifact coordinates + class name:

```
<projectRoot>/.jvm-oracle-cache/decompiled/<group>/<artifact>/<version>/<ClassName>.java
```

This means sequential agent calls for classes within the same dependency pay the decompilation cost only once.

---

## 7. Class Extraction Logic

Once a `ResolvedDependencyTree` is available, class lookup follows this priority order:

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

---

## 8. Interface Layer

### 8.1 CLI

```bash
# Install globally
npm install -g jvm-class-oracle

# Or run without installation
npx jvm-class-oracle com.example.MyClass

# With options
jvm-class-oracle com.example.MyClass \
  --project /path/to/project \
  --module :core:utils \
  --configuration compileClasspath \
  --include-test
```

Output is the Java source code on `stdout`. Errors go to `stderr` with a non-zero exit code, making the tool composable in shell pipelines and agent tool calls.

### 8.2 MCP Server

The same core logic is exposed as an MCP server, making the tool available to IDE-integrated agents (Claude Desktop, Cursor, Windsurf, Cline) without shell invocation overhead.

```json
{
  "mcpServers": {
    "jvm-class-oracle": {
      "command": "npx",
      "args": ["-y", "jvm-class-oracle", "--mcp"]
    }
  }
}
```

**Exposed MCP tools:**

| Tool | Description |
|---|---|
| `get_class_source` | Returns source or decompiled code for a fully-qualified class name |
| `list_modules` | Lists all submodules in a multimodule project with their dependency counts |
| `resolve_dependencies` | Returns the full resolved dependency tree for a project or module |

### 8.3 Dual-Entry Architecture

Both interfaces are thin wrappers over the same TypeScript module. The core logic is importable as a library for agents that prefer native function calls over shell or MCP:

```typescript
import { getClassSource } from 'jvm-class-oracle';

const source = await getClassSource('com.example.MyClass', {
  projectRoot: '/path/to/project',
  modulePath: ':core:utils',
});
```

---

## 9. Packaging & Distribution

### 9.1 NPM Package

The package bundles all auxiliary files so the tool works offline immediately after installation:

```
package.json           ← bin: { "jvm-class-oracle": "./dist/cli.js" }
dist/
  cli.js               ← compiled CLI entry point
  mcp.js               ← compiled MCP server entry point
  *.js                 ← compiled core modules
resources/
  cfr.jar              ← bundled CFR decompiler
  analyzer-init.gradle ← bundled Gradle init script
```

The `files` array in `package.json` ensures `resources/` is included in the published tarball. Bundled resource paths are resolved at runtime relative to `__dirname`.

### 9.2 Runtime Resource Resolution

```typescript
function getBundledResource(filename: string): string {
  const resourcePath = path.join(__dirname, '..', 'resources', filename);
  if (!fs.existsSync(resourcePath)) {
    throw new Error(
      `Bundled resource '${filename}' not found at ${resourcePath}. ` +
      `The package may be corrupted. Try reinstalling.`
    );
  }
  return resourcePath;
}

const CFR_JAR_PATH         = getBundledResource('cfr.jar');
const INIT_SCRIPT_PATH     = getBundledResource('analyzer-init.gradle');
```

### 9.3 Why NPM over a Native Binary

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
8. MCP server entry point with `get_class_source`, `list_modules`, `resolve_dependencies` tools
9. Structured error responses (unsupported project, class not found, version conflict)

Maven resolver is explicitly out of scope for v1 but the architecture accommodates it as a drop-in addition.

---

## 12. Future Work

| Item | Notes |
|---|---|
| `MavenResolver` | Parse `pom.xml`, invoke `mvn dependency:resolve`, same interface |
| `BazelResolver` | Use Bazel query API |
| Decompiler alternatives | Pluggable decompiler interface; allow Procyon or Fernflower as alternatives to CFR |
| Class search by simple name | `MyClass` instead of `com.example.MyClass` — return candidates for the agent to select |
