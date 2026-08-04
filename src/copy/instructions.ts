export const JVMSRC_INSTRUCTIONS = `
jvmsrc inspects external JVM dependencies — classes from JARs on the Gradle
classpath, not files in this repo. Gradle projects only.

Routing (strict):
- External dependency (in a JAR) → jvmsrc, always
- Local source under src/        → grep/glob/bash
- If jvmsrc fails, surface the error. Never fall back to javap, unzip, jar, or the Gradle cache — they silently pick the wrong version.

Use jvmsrc to:
- Understand an external class, interface, or annotation
- Find which dependency provides a type (unknown FQN or simple name)
- Verify a method signature, overload, or return type
- Inspect inherited members from an external superclass
- Debug NoSuchMethodError, AbstractMethodError, ClassCastException, or version mismatch (start with resolve_dependencies)

Tool ladder — narrowest first:
1. search_classes        — unknown FQN or simple name (also matches declared method names when sources enriched the index)
2. get_class_structure   — class purpose + method names (start here; scope=effective for inherited API)
3. get_method_signature  — one method's overloads (methodName singular; methodNames length-1 alias ok)
4. find_in_class_source  — literal or regex needle in a known class (default = literal)
5. search_in_artifact    — grep across one known dependency JAR when the class is unknown
6. get_class_source      — bodies; excerpt via methodNames or line range.
Full source is last resort.

If get_class_structure marks a method inherited: true, call get_method_signature /
get_class_source on the declaringClass (or use methodNames excerpts that walk supers).

Never use get_class_source full source to discover names. Never pass
full: true unless parsing JSON.

projectRoot = directory with gradlew. modulePath (e.g. ":app") scopes to
a submodule. When omitted, jvmsrc auto-picks the unique module that owns the
FQN; if several modules match, you get a conflict listing candidates. On a
miss in a multimodule project, retry with the leaf module that depends on the
JAR. First call invokes Gradle (5–10s); later calls reuse cache.
forceRefresh: true only after a SNAPSHOT republish.

Subagent isolation: if the Agent (subagent) tool is available, dispatch
to a subagent so verbose payloads stay out of the main context. Return a
written summary matching the defined goal, not raw output.

On errors or empty results, read message — it states what happened and the
next tool to try. found: false with querySucceeded: true is a successful
scan with no match, not a failure.
`;
