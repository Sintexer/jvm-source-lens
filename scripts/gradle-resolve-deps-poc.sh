#!/usr/bin/env bash
# Usage: gradle-resolve-deps-poc.sh [PROJECT_ROOT]
#   PROJECT_ROOT defaults to the current working directory.
#
# Runs Gradle with an external init script (no files added under the project).
# Prints one JSON document to stdout matching README 5.5.2 (schemaVersion 1.1+):
# eager resolution of compileClasspath, runtimeClasspath, testCompileClasspath,
# and testRuntimeClasspath per submodule; resolved versions; partial errors array.
#
# Task name: jvmsrcResolve (aligns with README §5.2).
#
# Limitations:
# - Configurations missing in a submodule are skipped (no error).
# - Android/Kotlin MPP may use different configuration names; those are skipped.
# - Gradle may download to ~/.gradle; the project directory is not modified.
# - Uses --no-configuration-cache: root jvmsrcResolve walks allprojects at
#   execution time; incompatible with configuration cache for this task shape.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INIT_SCRIPT="$REPO_ROOT/resources/analyzer-init.gradle"

PROJECT_ROOT="${1:-.}"
if [[ ! -d "$PROJECT_ROOT" ]]; then
  echo "Not a directory: $PROJECT_ROOT" >&2
  exit 1
fi
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"

if [[ ! -f "$INIT_SCRIPT" ]]; then
  echo "Missing init script: $INIT_SCRIPT" >&2
  exit 1
fi

if [[ ! -f "$PROJECT_ROOT/settings.gradle" && ! -f "$PROJECT_ROOT/settings.gradle.kts" \
      && ! -f "$PROJECT_ROOT/build.gradle" && ! -f "$PROJECT_ROOT/build.gradle.kts" ]]; then
  echo "No Gradle build files (settings.gradle[.kts] or build.gradle[.kts]) in $PROJECT_ROOT" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

GRADLE_PROPS=()
if [[ -f ./gradlew ]]; then
  if [[ -x ./gradlew ]]; then
    GRADLE_CMD=(./gradlew)
  else
    GRADLE_CMD=(bash ./gradlew)
  fi
  GRADLE_PROPS=(-PjvmsrcWrapper=true)
elif command -v gradle >/dev/null 2>&1; then
  GRADLE_CMD=(gradle)
  GRADLE_PROPS=(-PjvmsrcWrapper=false)
else
  echo "Neither ./gradlew nor 'gradle' on PATH found in $PROJECT_ROOT" >&2
  exit 1
fi

exec "${GRADLE_CMD[@]}" "${GRADLE_PROPS[@]}" \
  --no-configuration-cache \
  --init-script "$INIT_SCRIPT" \
  --quiet \
  jvmsrcResolve
