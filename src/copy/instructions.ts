export const JVMSRC_INSTRUCTIONS = `
jvmsrc reads third-party JVM dependencies: classes inside JARs on a Gradle project's classpath
(structure, signatures, source, versions). Gradle projects only.

Use it instead of memory, web search, or javap/unzip/Gradle-cache digging for any question about
a library class, method, or version — "what does X do", "which JAR has Y", NoSuchMethodError,
ClassCastException, version conflicts. Code under this repo's src/ → grep/read instead.

Flow: search_classes (only if the name is unknown) → get_class_structure → get_class_source with
methodNames. For version problems start with resolve_dependencies.

Omit projectRoot and modulePath unless an error asks for them. If a call fails, fix the arguments
as the error says and retry; never fall back to javap/unzip.
`;
