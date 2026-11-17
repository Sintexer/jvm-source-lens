# Maven eval project

Three-module Maven reactor used by the MCP eval harness (`bun run eval:maven`, see [../README.md](../README.md)). Mirrors the Gradle eval build in [`../project/`](../project/README.md) for the prompts in [`../maven-prompts.json`](../maven-prompts.json):

| Module | Notable dependencies |
|---|---|
| `eval-maven-parent` | `<packaging>pom</packaging>` aggregator (`core`, `app`, `worker`) |
| `core` | commons-lang3 3.14.0, local `com.acme.core.OrderValidator` |
| `app` | jackson-databind **2.15.2**, slf4j-api 2.0.9, spring-retry 2.0.4 (`RetryTemplate`), `core` |
| `worker` | jackson-databind **2.14.2** (different version on purpose), guava 32.1.2-jre (`ImmutableList`), slf4j-api 2.0.9, kotlinx-coroutines-core-jvm **1.10.2** (`DelayKt`), `core` |
