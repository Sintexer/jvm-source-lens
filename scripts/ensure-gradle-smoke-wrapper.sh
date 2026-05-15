#!/usr/bin/env bash
# Generate test/fixtures/gradle-smoke/gradle/wrapper/gradle-wrapper.jar (and refresh wrapper scripts)
# when missing. The JAR is gitignored; CI and developers run this before `bun test` if needed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/test/fixtures/gradle-smoke"
JAR="$FIXTURE/gradle/wrapper/gradle-wrapper.jar"

if [[ -f "$JAR" ]]; then
  exit 0
fi

if ! command -v gradle >/dev/null 2>&1; then
  echo "ensure-gradle-smoke-wrapper: gradle missing from PATH; cannot create $JAR" >&2
  exit 1
fi

(cd "$FIXTURE" && gradle wrapper --gradle-version=9.3.1 --no-daemon)

if [[ "$(uname -s)" != "MINGW"* ]] && [[ "${OSTYPE:-}" != "msys" ]]; then
  chmod +x "$FIXTURE/gradlew" 2>/dev/null || true
fi
