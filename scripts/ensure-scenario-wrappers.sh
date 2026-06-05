#!/usr/bin/env bash
# Generate gradle-wrapper.jar (and refresh wrapper scripts) for all Gradle projects under
# test/scenarios/gradle/ when missing. The JARs are gitignored; CI and developers run this
# before running scenario tests if needed.
#
# Usage:
#   bash scripts/ensure-scenario-wrappers.sh
#
# Requires `gradle` on PATH the first time (for generating wrapper JARs).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIOS_GRADLE="$ROOT/test/scenarios/gradle"
GRADLE_VERSION="9.3.1"

projects=(
  "multi-module"
  "local-maven-publish/producer"
  "local-maven-publish/consumer"
  "dependency-change/lib"
  "dependency-change/app"
  "version-conflict/lib"
  "version-conflict/adapter"
  "version-conflict/app"
  "gradle-properties-version/lib"
  "gradle-properties-version/app"
)

if ! command -v gradle >/dev/null 2>&1; then
  echo "ensure-scenario-wrappers: gradle missing from PATH; cannot generate wrapper JARs" >&2
  exit 1
fi

for project in "${projects[@]}"; do
  dir="$SCENARIOS_GRADLE/$project"
  jar="$dir/gradle/wrapper/gradle-wrapper.jar"

  if [[ -f "$jar" ]]; then
    echo "ensure-scenario-wrappers: $project — wrapper JAR already present, skipping"
    continue
  fi

  echo "ensure-scenario-wrappers: $project — generating wrapper JAR..."
  (cd "$dir" && gradle wrapper --gradle-version="$GRADLE_VERSION" --no-daemon)

  if [[ "$(uname -s)" != "MINGW"* ]] && [[ "${OSTYPE:-}" != "msys" ]]; then
    chmod +x "$dir/gradlew" 2>/dev/null || true
  fi
  echo "ensure-scenario-wrappers: $project — done"
done
