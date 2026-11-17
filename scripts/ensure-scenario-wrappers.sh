#!/usr/bin/env bash
# Generate gitignored wrapper JARs (and refresh wrapper scripts) for all Gradle and Maven
# projects under test/scenarios/ when missing.
#
# Usage:
#   bash scripts/ensure-scenario-wrappers.sh
#
# Requires `gradle` on PATH when Gradle wrapper JARs are missing, and `mvn` (via
# JVMSRC_MAVEN_BIN, MAVEN_HOME, M2_HOME, PATH, or IntelliJ bundled Maven) when Maven
# wrapper JARs are missing.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIOS_GRADLE="$ROOT/test/scenarios/gradle"
SCENARIOS_MAVEN="$ROOT/test/scenarios/maven"
GRADLE_VERSION="9.3.1"
MAVEN_VERSION="3.9.9"

gradle_projects=(
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
  "flatdir-jar/app"
  "kotlin-library/producer"
  "kotlin-library/consumer"
)

maven_projects=(
  "single-module/producer-sourced"
  "single-module/producer-binary"
  "single-module/app"
  "version-conflict/lib"
  "version-conflict/adapter"
  "version-conflict/app"
  "local-install-snapshot/producer"
  "local-install-snapshot/consumer"
)

need_gradle=0
for project in "${gradle_projects[@]}"; do
  if [[ ! -f "$SCENARIOS_GRADLE/$project/gradle/wrapper/gradle-wrapper.jar" ]]; then
    need_gradle=1
    break
  fi
done

if [[ "$need_gradle" -eq 1 ]] && ! command -v gradle >/dev/null 2>&1; then
  echo "ensure-scenario-wrappers: gradle missing from PATH; cannot generate Gradle wrapper JARs" >&2
  exit 1
fi

for project in "${gradle_projects[@]}"; do
  dir="$SCENARIOS_GRADLE/$project"
  jar="$dir/gradle/wrapper/gradle-wrapper.jar"

  if [[ -f "$jar" ]]; then
    echo "ensure-scenario-wrappers: gradle/$project — wrapper JAR already present, skipping"
    continue
  fi

  echo "ensure-scenario-wrappers: gradle/$project — generating wrapper JAR..."
  (cd "$dir" && gradle wrapper --gradle-version="$GRADLE_VERSION" --no-daemon)

  if [[ "$(uname -s)" != "MINGW"* ]] && [[ "${OSTYPE:-}" != "msys" ]]; then
    chmod +x "$dir/gradlew" 2>/dev/null || true
  fi
  echo "ensure-scenario-wrappers: gradle/$project — done"
done

resolve_mvn_bin() {
  if [[ -n "${JVMSRC_MAVEN_BIN:-}" && -x "${JVMSRC_MAVEN_BIN}" ]]; then
    printf '%s\n' "${JVMSRC_MAVEN_BIN}"
    return 0
  fi
  if [[ -n "${MAVEN_HOME:-}" && -x "${MAVEN_HOME}/bin/mvn" ]]; then
    printf '%s\n' "${MAVEN_HOME}/bin/mvn"
    return 0
  fi
  if [[ -n "${M2_HOME:-}" && -x "${M2_HOME}/bin/mvn" ]]; then
    printf '%s\n' "${M2_HOME}/bin/mvn"
    return 0
  fi
  if command -v mvn >/dev/null 2>&1; then
    command -v mvn
    return 0
  fi
  local candidate
  shopt -s nullglob
  for candidate in \
    "$HOME"/Applications/IntelliJ*.app/Contents/plugins/maven/lib/maven3/bin/mvn \
    /Applications/IntelliJ*.app/Contents/plugins/maven/lib/maven3/bin/mvn; do
    if [[ -x "$candidate" ]]; then
      shopt -u nullglob
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

need_maven=0
for project in "${maven_projects[@]}"; do
  if [[ ! -f "$SCENARIOS_MAVEN/$project/.mvn/wrapper/maven-wrapper.jar" ]]; then
    need_maven=1
    break
  fi
done

if [[ "$need_maven" -eq 1 ]]; then
  if ! MVN_BIN="$(resolve_mvn_bin)"; then
    echo "ensure-scenario-wrappers: mvn not found; cannot generate Maven wrapper JARs" >&2
    exit 1
  fi
  for project in "${maven_projects[@]}"; do
    dir="$SCENARIOS_MAVEN/$project"
    jar="$dir/.mvn/wrapper/maven-wrapper.jar"

    if [[ -f "$jar" ]]; then
      echo "ensure-scenario-wrappers: maven/$project — wrapper JAR already present, skipping"
      continue
    fi

    echo "ensure-scenario-wrappers: maven/$project — generating wrapper JAR..."
    (cd "$dir" && "$MVN_BIN" -B -q wrapper:wrapper -Dmaven="$MAVEN_VERSION" -Dtype=bin)

    if [[ "$(uname -s)" != "MINGW"* ]] && [[ "${OSTYPE:-}" != "msys" ]]; then
      chmod +x "$dir/mvnw" 2>/dev/null || true
    fi
    echo "ensure-scenario-wrappers: maven/$project — done"
  done
else
  for project in "${maven_projects[@]}"; do
    echo "ensure-scenario-wrappers: maven/$project — wrapper JAR already present, skipping"
  done
fi
