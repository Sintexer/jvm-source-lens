# JVM Dependency Inspection — jvmsrc

## When This Skill Applies

Activate this skill whenever you are:
- Writing code that calls, extends, or implements an external library class
- Debugging a ClassCastException, NoSuchMethodError, or unexpected behavior from a dependency
- Generating code that constructs, serializes, or annotates objects from external types
- Resolving a type from a stack trace, log output, or partial class name
- Investigating which version of a library this project actually uses
- Comparing API surfaces across candidate classes before choosing one

**Do not skip this skill** because you recognize a library name. Your training data
reflects a point-in-time snapshot of a library's API. The project may use a different
version. Always verify against what is actually on the classpath.

---

## Prime Directive

**Never inspect JVM dependencies manually.** Do not:
- Run `javap`, `unzip`, or `jar -tf` to read class contents
- Read or search `~/.gradle/caches`, `~/.m2/repository`, or any build output directory
- Infer method signatures, field names, or type hierarchies from memory

The dependency cache is global and contains multiple versions of every library. Manual
inspection silently picks the wrong one. Only `jvmsrc` resolves the version this
specific project uses. A confidently wrong signature is worse than an honest failure.

If `jvmsrc` is not available or fails, say so explicitly. Do not substitute manual
inspection as a fallback.

---

## The Workflow

### Step 1 — Establish project context (once per session)

Before any class lookup, ensure you know:
- The absolute `projectRoot` path
- Which Gradle `modulePath` to use when scoping (e.g. `:app`) — omit for single-module projects

For multimodule projects, discover module names **once per session** from the repo
(`settings.gradle` / `include(...)` lines) or from `resolve_dependencies` →
`resolution.modules[].name`. Do not guess directory names; Gradle logical names may differ.

Cache this context. Do not re-resolve on every call unless dependencies changed.

---

### Step 2 — Find the class (when FQN is unknown)

If you have a simple name, a partial name, or a capability description but not the
fully-qualified class name:

```
search_classes(query: "TradingMaskUtils", projectRoot: "/path/to/gradle-project-root")
search_classes(query: "PageRequest", projectRoot: "...", modulePath: ":core")
search_classes(query: "*Repository", projectRoot: "...")
search_classes(query: "cache", projectRoot: "...")      // capability discovery
```

If `search_classes` returns candidates, use the FQN from the hit — then
`get_method_signature` / `get_class_structure` / `get_class_source`.

If you already have the FQN from an `import` line in project code, **skip**
`search_classes` and globbing — call `get_*` with that FQN directly.

Pick the best candidate from `search_classes` results. If multiple candidates are
plausible, use `get_class_structure` on each to compare before choosing.

**If workspace file search returned 0 files for `Something.java`:** that is expected
for classpath-only types — run `search_classes` or `get` with the import FQN before
concluding the type is unavailable.

---

### Step 3 — Inspect what you need (not more)

Use the most specific tool for the task. Do not fetch full source when a signature
is enough — it wastes context and slows the agent down.

| Task | Tool |
|---|---|
| Need to call a method — check its parameters and return type | `get_method_signature` |
| Need to extend a class or implement an interface | `get_class_structure` |
| Need to construct an object — check constructors | `get_method_signature` with `methodName: "<init>"` |
| Need to understand what fields a class has | `get_class_structure` |
| Need to check annotations (Spring, JPA, Jackson) | `get_class_structure` |
| Need to verify type hierarchy before a cast or assignment | `get_class_structure` |
| Need to read one or a few method bodies (not the whole file) | `get_class_source` with **`methodNames`** (or **`methodName`**) |
| Need a specific line range from a large compilation unit | `get_class_source` with **`startLine`** + **`endLine`** |
| Know the class but need a string/pattern inside the file (log message, `throw new`, call site) | **`find_in_class_source`** |
| Need the full implementation of a small class | `get_class_source` (no excerpt params) |
| Need exact JVM descriptors or bridge/synthetic members | `get_method_signature` with `bytecodeOnly: true` |

**Default escalation path:**
`get_method_signature` → `get_class_structure` → **`find_in_class_source`** (needle in file) → `get_class_source` **(excerpt)** → `get_class_source` **(full file)**

Start at the left. Only move right when the previous step did not give you enough.
Before requesting the **full** compilation unit, try an **excerpt** when you already
know the method name(s) or line range. Full-file `get_class_source` should be the
exception, not the default.

#### Source excerpts (`get_class_source`)

Use excerpts to avoid dumping huge JAR sources into context.

**By method (preferred when you know names):**
```
get_class_source(
  className: "com.example.Service",
  projectRoot: "...",
  methodNames: ["process", "validate"]   // multiple methods in one call
)
```
- **`methodName`** — optional convenience when only one method is needed (merged into `methodNames`).
- **`<init>`** — constructors (all overloads for that name are included).
- Response may include **`excerpt`**: `matchedMethodNames`, `unmatchedMethodNames`, `lineNumbersReliable`.

**By line range (when you have a line from a stack trace or prior read):**
```
get_class_source(
  className: "com.example.Service",
  projectRoot: "...",
  startLine: 120,
  endLine: 145
)
```
Both **`startLine`** and **`endLine`** are required; they are **1-based inclusive**.

**Combine** method names and a line range in one call when both anchors are known — spans are merged.

**CLI equivalent:** `jvmsrc get … --method process --method validate` or `--start-line 120 --end-line 145`.

When **`sourceAvailable: false`** (CFR decompilation), method excerpts still work in most cases, but **`excerpt.lineNumbersReliable`** is **`false`** — treat line-based slices as approximate.

#### Find in resolved source (`find_in_class_source`)

Use when you know the **FQN** but need a **needle inside the file** — not workspace `grep` (wrong version / JAR-only types).

```
find_in_class_source(
  className: "com.example.Service",
  projectRoot: "...",
  query: "failed to connect",
  contextLines: 3,
  maxHits: 10
)
```

- Default: **literal** substring (case-sensitive). Set **`regex: true`** for JavaScript regex (bounded cost).
- **`found: false`, `querySucceeded: true`** — class resolved, query absent; adjust `query` or use `get_class_structure`.
- Same **`modulePath`** / scoping as other tools. CLI: `jvmsrc find-in-class com.example.Foo "needle" -p /project`.

**Not a substitute for** `search_classes` (classpath-wide FQN discovery).

---

### Step 4 — Write code against verified contracts

After inspecting the class, write code using exactly the signatures returned by jvmsrc.

**Always note `sourceAvailable` in the response:**
- `true` — Javadoc, parameter names, and generics are ground truth. Use them directly.
- `false` — CFR decompilation. Types and structure are reliable; parameter names may be
  synthetic (`arg0`, `arg1`). Cross-reference with `get_method_signature` if names matter.

Never generate a method call from memory after a tool call has returned the actual
signature. Use the tool's output as the source of truth.

---

### Step 5 — Debug with the classpath, not assumptions

When debugging dependency-related failures:

**`NoSuchMethodError` / `AbstractMethodError`**
→ Version mismatch. Run `resolve_dependencies` to check what version is actually resolved.
Compare against what the call site expects.

**`ClassCastException` across library boundaries**
→ Type loaded by different classloaders or wrong version. Check `resolve_dependencies`
for duplicate artifact coordinates across modules.

**Method behaves unexpectedly**
→ `get_class_source` with **`methodNames`** for that method (not the full file). Check whether
`sourceAvailable: false` — if so, behavior is decompiled and may have edge cases
that CFR did not reconstruct faithfully. Check the version with `resolve_dependencies`.

**Stack trace contains an unfamiliar class**
→ `search_classes` with the simple name from the trace. Then `get_class_structure`
to understand what it is; use **`get_class_source` excerpt** only if you need the body.

**Suspecting a stale dependency (SNAPSHOT or post-cache-wipe)**
→ `resolve_dependencies` with `forceRefresh: true`. Only use `forceRefresh` when
you have a specific reason — not as a default.

---

## Error Handling

| errorCategory | Action |
|---|---|
| `transient` | Retry once after a short delay. If it fails again, surface the error. |
| `validation` | Fix the input (wrong FQN, bad modulePath, bad excerpt params). Do not retry same input. |
| `business` | Expected outcome — read carefully before acting (see below). |
| `permission` | Environment problem. Surface it. Do not retry. |

**Critical business outcomes — do not misread as tool failures:**

- `found: false, querySucceeded: true` — the classpath was fully scanned; the class
  simply is not there. Verify the FQN or check whether the dependency is declared
  in the build file. Do not retry. Do not fall back to manual inspection.

- `found: true, methodFound: false` — the class exists but that method name has no
  matching overload. Run `get_class_structure` to browse the actual method list.

- `sourceAvailable: false` — not an error. CFR decompilation ran automatically.
  Structure is reliable. Proceed, noting the lower confidence on names/Javadoc.

**Excerpt-specific failures (`validation`):**

- **`EXCERPT_NOT_FOUND`** — none of the requested `methodNames` matched (or the type could not be parsed for method excerpt). Use `get_class_structure` to list real method names, then retry with correct names.
- **`EXCERPT_REQUEST_INVALID`** — bad line range (only one of `startLine`/`endLine`, out of range, or `startLine > endLine`). Fix parameters; do not retry unchanged.

On any unrecoverable error: surface the `code` and `description` to the user.
Never substitute manual inspection as a recovery path.

---

## Multimodule Projects

- Always pass `modulePath` when you know which module you are working in.
  Without it, the tool searches all modules and will surface a conflict if the same
  class resolves to different versions across modules.
- Get `modulePath` from `settings.gradle` or `resolve_dependencies` — Gradle names like
  `:core:api` may differ from folder names.
- Inter-project classes (your own code in a sibling module) resolve from
  `src/main/java` automatically — you get original source even before a build runs.

---

## Quick Reference

```
# Discover submodules (once) or warm cache
resolve_dependencies(projectRoot)

# Find a class when FQN is unknown
search_classes(query, projectRoot, modulePath?)

# Check a method before calling it
get_method_signature(className, methodName, projectRoot, modulePath?)

# Browse a class's full API surface
get_class_structure(className, projectRoot, modulePath?)

# Find a string inside one class (log literal, throw message, etc.)
find_in_class_source(className, projectRoot, query, modulePath?, contextLines?, maxHits?)

# Read specific method bodies (preferred over full file)
get_class_source(className, projectRoot, modulePath?, methodNames: ["run", "stop"])

# Read a line slice (both startLine and endLine required)
get_class_source(className, projectRoot, startLine: 100, endLine: 150)

# Read the full compilation unit (last resort)
get_class_source(className, projectRoot, modulePath?)

# Inspect the resolved dependency tree
resolve_dependencies(projectRoot, forceRefresh?)
```

**Constructors:** `get_method_signature` with `methodName: "<init>"`; excerpts use `methodNames: ["<init>"]`
**Strict JVM descriptors:** `get_method_signature` with `bytecodeOnly: true`
**Stale cache:** `resolve_dependencies` with `forceRefresh: true`
**Large dependency sources:** excerpt first (`methodNames`), full file only if needed
