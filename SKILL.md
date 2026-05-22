# JVM Dependency Inspection — jvmsrc

## When This Skill Applies

Use for any task involving **external or sibling-module JVM types**: library APIs, stack traces, version checks, casts, serialization, annotations on dependency types.

**Do not skip** because you recognize a library name — training data may be the wrong version. **Gradle projects only** today (no Maven/Bazel); point `projectRoot` at the Gradle root (`gradlew` tree).

---

## Prime Directive

**Never inspect JVM dependencies manually.** Do not run `javap`, `unzip`, `jar -tf`, or read/search `~/.gradle/caches`, `~/.m2/repository`, or build output dirs. Global caches hold many versions; only **jvmsrc** resolves the version **this project** uses.

If jvmsrc is unavailable or fails, say so — **do not** substitute manual inspection.

**Never use workspace file search** for dependency types: `**/Foo.java` returning 0 hits is normal. Use `search_classes` or `get_*` with the import FQN.

---

## Workflow

### 1 — Context (once per session)

- Absolute **`projectRoot`** (Gradle root)
- **`modulePath`** when scoping (e.g. `:app`) — from `settings.gradle` or `resolve_dependencies` → `resolution.modules[].name`; omit for single-module
- Cache context; re-resolve only when dependencies change

### 2 — Find FQN (if unknown)

```
search_classes(query: "TradingMaskUtils", projectRoot: "/abs/path/to/gradle-root")
search_classes(query: "*Repository", projectRoot: "...", modulePath: ":core", limit: 50)
```

Skip if you already have the FQN from an `import`. Pick best hit; disambiguate with `get_class_structure` if needed.

### 3 — Inspect (compact text default)

**Default:** plain text responses. Do **not** pass `full: true` unless parsing JSON. **`--verbose`** on CLI is Gradle stderr only.

**Discovery ladder:** `search_classes` → `get_class_structure` (**`scope: overview`**) → `get_method_signature` → `get_class_structure` (**`scope: declared`**) → `find_in_class_source` → `get_class_source` (excerpt) → full file / `full: true`.

| Need | Tool |
|------|------|
| What is this class? (purpose, method names) | `get_class_structure` (default overview) |
| One method’s overloads | `get_method_signature` |
| Declared signatures as lines | `get_class_structure` `scope: declared` |
| String/regex in known class | `find_in_class_source` |
| Method bodies / line slice | `get_class_source` with `methodNames` / line range |
| JVM descriptors | `get_method_signature` `bytecodeOnly: true` |
| Module list (text) | `resolve_dependencies` — `full: true` only for full JSON graph |

**`get_class_source` excerpts:** `methodNames` (or single `methodName`); `<init>` for constructors; response may include `excerpt` with `matchedMethodNames` / `unmatchedMethodNames`. Line ranges are **1-based inclusive**. When `sourceAvailable: false`, `lineNumbersReliable` may be false.

**Full file is last resort.** If response has **`outputTruncated: true`**, you do not have the whole compilation unit — use excerpts, `get_class_structure`, or raise limits; do not assume missing code is absent.

**`find_in_class_source`:** `found: false`, `querySucceeded: true` means class resolved but pattern absent. Not a substitute for `search_classes`.

### 4 — Write code from tool output

- **`sourceAvailable: true`** — Javadoc, names, generics are ground truth
- **`sourceAvailable: false`** — CFR; structure reliable, names may be synthetic (`arg0`) — confirm with `get_method_signature` if names matter

Never invent signatures after a tool returned the real ones.

### 5 — Debug patterns

| Symptom | Action |
|---------|--------|
| `NoSuchMethodError` / `AbstractMethodError` | `resolve_dependencies` — version mismatch |
| `ClassCastException` across libs | `resolve_dependencies` — duplicate coordinates |
| Unexpected behavior | `get_class_source` excerpt for that method; check `sourceAvailable` and version |
| Unfamiliar class in trace | `search_classes` → `get_class_structure` |
| Stale SNAPSHOT / cache wipe | `resolve_dependencies(forceRefresh: true)` — only when justified |

---

## Errors

| errorCategory | Action |
|---------------|--------|
| `transient` | Retry once, then surface |
| `validation` | Fix input; don't retry unchanged |
| `business` | Read outcome (below) |
| `permission` | Surface; don't retry |

**Business (not failures):**

- `found: false`, `querySucceeded: true` — class not on classpath; fix FQN or dependency declaration
- `found: true`, `methodFound: false` — class exists; wrong method name → `get_class_structure`
- `sourceAvailable: false` — decompilation used; proceed with lower name/Javadoc confidence
- `EXCERPT_NOT_FOUND` / `EXCERPT_REQUEST_INVALID` — fix `methodNames` or line range

Never recover with manual cache/javap inspection.

---

## Multimodule

Pass **`modulePath`** when known. Without it, all modules are searched; conflicts are surfaced if the same FQN maps to different versions. Inter-project deps resolve from `src/main/java` with original source.

---

## Quick reference

```
search_classes(query, projectRoot, modulePath?, limit?)
get_class_structure(className, projectRoot, scope: "overview")   # discovery
get_class_structure(className, projectRoot, scope: "declared")  # signature lines
get_method_signature(className, methodName, projectRoot, modulePath?)
find_in_class_source(className, projectRoot, query, ...)
get_class_source(className, projectRoot, methodNames: ["foo"])
resolve_dependencies(projectRoot)   # text summary; full: true for JSON
```

**CLI:** `jvmsrc get … --method foo`, `jvmsrc find-in-class Fqn "needle" -p …`
