# Eval project

Tiny three-module Gradle project used by the MCP eval harness (`bun run eval`, see [../README.md](../README.md)). It needs network access to Maven Central the first time Gradle resolves it and uses the system `gradle`. It is shaped for the prompts in [`../prompts.json`](../prompts.json):

| Module | Notable dependencies |
|---|---|
| root | applies `java` with no dependencies: a `compileClasspath` that exists but is **empty**, like many real builds (it once shadowed the submodules when `modulePath` was omitted) |
| `:core` | commons-lang3 3.14.0 (`api`), a local `UserService` class |
| `:app` | jackson-databind **2.15.2**, slf4j-api, spring-retry (`RetryTemplate`), `:core` |
| `:worker` | jackson-databind **2.14.2** (different version on purpose), guava (`Lists`, `ImmutableList`), slf4j-api |
