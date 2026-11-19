import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { computeBuildInputsDigest } from '../../cache/index.js';
import { GradleResolver } from './index.js';
import { listGradleBuildInputRelativePaths } from './cache-inputs.js';

let tmp: string;

function write(rel: string, content = 'x'): void {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-gradle-inputs-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('listGradleBuildInputRelativePaths', () => {
  test('shouldIncludeBuildSrcSourcesWhenBuildSrcExists', () => {
    write('app/settings.gradle', "rootProject.name = 'app'");
    write('app/build.gradle');
    write('app/buildSrc/src/main/java/Deps.java');
    write('app/buildSrc/src/main/kotlin/Other.kt');
    write('app/buildSrc/build/classes/Deps.class');
    write('app/buildSrc/.gradle/x.bin');

    const files = listGradleBuildInputRelativePaths(path.join(tmp, 'app'));

    expect(files).toContain('buildSrc/src/main/java/Deps.java');
    expect(files).toContain('buildSrc/src/main/kotlin/Other.kt');
    expect(files).not.toContain('buildSrc/build/classes/Deps.class');
    expect(files).not.toContain('buildSrc/.gradle/x.bin');
  });

  test('shouldIncludeBuildLogicSourcesWhenBuildLogicExists', () => {
    write('app/settings.gradle');
    write('app/build-logic/src/main/groovy/conv.gradle');
    write('app/build-logic/src/main/resources/notes.txt');

    const files = listGradleBuildInputRelativePaths(path.join(tmp, 'app'));

    expect(files).toContain('build-logic/src/main/groovy/conv.gradle');
    expect(files).not.toContain('build-logic/src/main/resources/notes.txt');
  });

  test('shouldIncludeIncludedBuildOutsideRootWhenSettingsDeclaresIt', () => {
    write('app/settings.gradle', "rootProject.name = 'app'\nincludeBuild '../picker'\n");
    write('picker/settings.gradle');
    write('picker/build.gradle');
    write('picker/src/main/java/Picker.java');

    const files = listGradleBuildInputRelativePaths(path.join(tmp, 'app'));

    expect(files).toContain('../picker/src/main/java/Picker.java');
    expect(files).toContain('../picker/build.gradle');
  });

  test('shouldIncludeIncludedBuildWhenDeclaredInPluginManagementWithKotlinDsl', () => {
    write('app/settings.gradle.kts', 'pluginManagement {\n  includeBuild("../picker")\n}\n');
    write('picker/src/main/java/Picker.java');

    const files = listGradleBuildInputRelativePaths(path.join(tmp, 'app'));

    expect(files).toContain('../picker/src/main/java/Picker.java');
  });

  test('shouldFollowNestedIncludedBuildsWhenIncludedBuildIncludesAnother', () => {
    write('app/settings.gradle', "includeBuild '../a'");
    write('a/settings.gradle', "includeBuild '../b'");
    write('b/src/main/java/B.java');

    const files = listGradleBuildInputRelativePaths(path.join(tmp, 'app'));

    expect(files).toContain('../b/src/main/java/B.java');
  });

  test('shouldNotLoopWhenIncludedBuildsReferenceEachOther', () => {
    write('app/settings.gradle', "includeBuild '../a'");
    write('a/settings.gradle', "includeBuild '../app'");
    write('a/src/A.java');

    const files = listGradleBuildInputRelativePaths(path.join(tmp, 'app'));

    expect(files).toContain('../a/src/A.java');
  });

  test('shouldIgnoreMissingIncludedBuildDirectory', () => {
    write('app/settings.gradle', "includeBuild '../missing'");
    expect(() => listGradleBuildInputRelativePaths(path.join(tmp, 'app'))).not.toThrow();
  });
});

describe('computeBuildInputsDigest (gradle)', () => {
  test('shouldChangeDigestWhenBuildSrcSourceChanges', () => {
    write('app/settings.gradle');
    write('app/build.gradle');
    write('app/buildSrc/src/main/java/Deps.java', 'v1');
    const before = computeBuildInputsDigest(path.join(tmp, 'app'), new GradleResolver());

    write('app/buildSrc/src/main/java/Deps.java', 'v2');

    expect(computeBuildInputsDigest(path.join(tmp, 'app'), new GradleResolver())).not.toBe(before);
  });

  test('shouldChangeDigestWhenIncludedBuildSourceChanges', () => {
    write('app/settings.gradle', "includeBuild '../picker'");
    write('picker/src/main/java/Picker.java', 'v1');
    const before = computeBuildInputsDigest(path.join(tmp, 'app'), new GradleResolver());

    write('picker/src/main/java/Picker.java', 'v2');

    expect(computeBuildInputsDigest(path.join(tmp, 'app'), new GradleResolver())).not.toBe(before);
  });
});
