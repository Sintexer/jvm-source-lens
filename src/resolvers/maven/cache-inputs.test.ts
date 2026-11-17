import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ResolvedArtifact } from '../resolution-output.js';
import {
  isMavenImmutableArtifact,
  listMavenBuildInputRelativePaths,
  mavenCacheInputs,
  resolveMavenLocalRepository,
} from './cache-inputs.js';

function makeArt(override: Partial<ResolvedArtifact>): ResolvedArtifact {
  return {
    group: 'com.example',
    name: 'lib',
    version: '1.0.0',
    type: 'jar',
    jarPath: null,
    sourcesJarPath: null,
    origin: 'external',
    direct: true,
    ...override,
  };
}

describe('Maven cache inputs and immutability', () => {
  let tmp = '';

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  test('lists all reactor pom.xml files and .mvn config files while skipping target and symlinks', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-ci-'));
    fs.mkdirSync(path.join(tmp, '.mvn', 'wrapper'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'app', 'target'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(tmp, 'app', 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(tmp, 'lib', 'pom.xml'), '<project/>');
    // pom.xml inside target/ must be ignored
    fs.writeFileSync(path.join(tmp, 'app', 'target', 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(tmp, '.mvn', 'maven.config'), '-Drevision=1.0\n');
    fs.writeFileSync(path.join(tmp, '.mvn', 'jvm.config'), '-Xmx1g\n');
    fs.writeFileSync(path.join(tmp, '.mvn', 'extensions.xml'), '<extensions/>');
    fs.writeFileSync(
      path.join(tmp, '.mvn', 'wrapper', 'maven-wrapper.properties'),
      'distributionUrl=https://repo.maven.apache.org/maven2/...\n',
    );
    fs.symlinkSync('..', path.join(tmp, 'lib', 'loop'), 'dir');

    expect(listMavenBuildInputRelativePaths(tmp)).toEqual([
      '.mvn/extensions.xml',
      '.mvn/jvm.config',
      '.mvn/maven.config',
      '.mvn/wrapper/maven-wrapper.properties',
      'app/pom.xml',
      'lib/pom.xml',
      'pom.xml',
    ]);
  });

  test('resolveMavenLocalRepository prefers .mvn/maven.config -Dmaven.repo.local over settings.xml', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-repo-'));
    const proj = path.join(tmp, 'proj');
    const fakeHome = path.join(tmp, 'home');
    fs.mkdirSync(path.join(proj, '.mvn'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.m2'), { recursive: true });

    expect(resolveMavenLocalRepository(proj, fakeHome)).toBe(
      path.join(fakeHome, '.m2', 'repository'),
    );

    fs.writeFileSync(
      path.join(fakeHome, '.m2', 'settings.xml'),
      '<settings><localRepository>/custom/from-settings</localRepository></settings>',
      'utf8',
    );
    expect(resolveMavenLocalRepository(proj, fakeHome)).toBe('/custom/from-settings');

    fs.writeFileSync(
      path.join(proj, '.mvn', 'maven.config'),
      '-Dmaven.repo.local=/custom/from-maven-config\n',
      'utf8',
    );
    expect(resolveMavenLocalRepository(proj, fakeHome)).toBe('/custom/from-maven-config');

    const inputs = mavenCacheInputs(proj, fakeHome);
    expect(inputs.env[0]).toEqual(['M2_LOCAL_REPO', '/custom/from-maven-config']);
    // settings.xml is hashed to 64-char hex, never raw XML
    expect(inputs.env[1]?.[0]).toBe('M2_SETTINGS_SHA256');
    expect(inputs.env[1]?.[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  test('isMavenImmutableArtifact marks SNAPSHOTs and external paths mutable and release m2 jars immutable', () => {
    const repo = path.join(os.tmpdir(), 'fake-m2-repo');
    const releaseJar = path.join(repo, 'com', 'example', 'lib', '1.0.0', 'lib-1.0.0.jar');
    const snapshotJar = path.join(
      repo,
      'com',
      'example',
      'lib',
      '1.0.0-SNAPSHOT',
      'lib-1.0.0-SNAPSHOT.jar',
    );
    const outsideJar = path.join(os.tmpdir(), 'other-dir', 'lib-1.0.0.jar');

    expect(isMavenImmutableArtifact(makeArt({ version: '1.0.0', jarPath: releaseJar }), repo)).toBe(
      true,
    );
    expect(
      isMavenImmutableArtifact(makeArt({ version: '1.0.0-SNAPSHOT', jarPath: snapshotJar }), repo),
    ).toBe(false);
    expect(isMavenImmutableArtifact(makeArt({ version: null, jarPath: releaseJar }), repo)).toBe(
      false,
    );
    expect(isMavenImmutableArtifact(makeArt({ version: '1.0.0', jarPath: outsideJar }), repo)).toBe(
      false,
    );
  });

  describe('digest gaps', () => {
    function project(): { root: string; home: string } {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-gap-'));
      const root = path.join(tmp, 'proj');
      const home = path.join(tmp, 'home');
      fs.mkdirSync(root, { recursive: true });
      fs.mkdirSync(path.join(home, '.m2'), { recursive: true });
      return { root, home };
    }
    function write(file: string, text: string): void {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    const envOf = (inputs: ReturnType<typeof mavenCacheInputs>, prefix: string): [string, string][] =>
      inputs.env.filter(([k]) => k.startsWith(prefix));

    test('shouldListReactorModuleUnderSkippedDirWhenParentPomDeclaresIt', () => {
      const { root } = project();
      write(
        path.join(root, 'pom.xml'),
        '<project><modules><module>dist/api</module><module>build/app/core</module></modules></project>',
      );
      write(path.join(root, 'dist', 'api', 'pom.xml'), '<project/>');
      write(path.join(root, 'build', 'app', 'core', 'pom.xml'), '<project/>');
      write(path.join(root, 'bin', 'pom.xml'), '<project/>');
      write(path.join(root, 'out', 'x', 'pom.xml'), '<project/>');
      expect(listMavenBuildInputRelativePaths(root)).toEqual(['build/app/core/pom.xml', 'dist/api/pom.xml', 'pom.xml']);
    });

    test('shouldNotListPomUnderTargetWhenParentDeclaresItAsModule', () => {
      const { root } = project();
      write(path.join(root, 'pom.xml'), '<project><modules><module>target/gen</module></modules></project>');
      write(path.join(root, 'target', 'gen', 'pom.xml'), '<project/>');
      expect(listMavenBuildInputRelativePaths(root)).toEqual(['pom.xml']);
    });

    test('shouldHashParentPomOutsideTreeWhenRelativePathLeavesTheRoot', () => {
      const { root, home } = project();
      const parent = path.join(tmp, 'company-parent', 'pom.xml');
      write(parent, '<project><artifactId>p</artifactId></project>');
      write(
        path.join(root, 'pom.xml'),
        '<project><parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version>' +
          '<relativePath>../company-parent/pom.xml</relativePath></parent></project>',
      );
      const first = envOf(mavenCacheInputs(root, home, {}), 'M2_PARENT_POM_SHA256');
      expect(first).toHaveLength(1);
      expect(first[0]![0]).toContain(parent);
      expect(first[0]![1]).toMatch(/^[0-9a-f]{64}$/);
      write(parent, '<project><artifactId>p</artifactId><properties><x>1</x></properties></project>');
      const second = envOf(mavenCacheInputs(root, home, {}), 'M2_PARENT_POM_SHA256');
      expect(second[0]![1]).not.toBe(first[0]![1]);
    });

    test('shouldFollowOutOfTreeParentChainWhenParentHasItsOwnParent', () => {
      const { root, home } = project();
      write(path.join(tmp, 'grand', 'pom.xml'), '<project/>');
      write(
        path.join(tmp, 'parent', 'pom.xml'),
        '<project><parent><relativePath>../grand/pom.xml</relativePath></parent></project>',
      );
      write(path.join(root, 'pom.xml'), '<project><parent><relativePath>../parent</relativePath></parent></project>');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_PARENT_POM_SHA256')).toHaveLength(2);
    });

    test('shouldStopWhenParentPomsFormACycle', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project><parent><relativePath>../a/pom.xml</relativePath></parent></project>');
      write(path.join(tmp, 'a', 'pom.xml'), '<project><parent><relativePath>../b/pom.xml</relativePath></parent></project>');
      write(path.join(tmp, 'b', 'pom.xml'), '<project><parent><relativePath>../a/pom.xml</relativePath></parent></project>');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_PARENT_POM_SHA256')).toHaveLength(2);
    });

    test('shouldIgnoreParentWhenRelativePathIsEmptyOrInsideTheTree', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project><parent><relativePath/></parent></project>');
      write(path.join(root, 'app', 'pom.xml'), '<project><parent><artifactId>r</artifactId></parent></project>');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_PARENT_POM_SHA256')).toEqual([]);
    });

    test('shouldHashSettingsFileFromMavenConfigWhenDashSIsGiven', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project/>');
      write(path.join(root, 'ci-settings.xml'), '<settings/>');
      for (const line of ['-s ci-settings.xml', '--settings ci-settings.xml', '--settings=ci-settings.xml']) {
        write(path.join(root, '.mvn', 'maven.config'), `-B\n${line}\n`);
        const got = envOf(mavenCacheInputs(root, home, {}), 'M2_SETTINGS_FILE_SHA256');
        expect(got).toHaveLength(1);
        expect(got[0]![1]).toMatch(/^[0-9a-f]{64}$/);
      }
      write(path.join(root, 'ci-settings.xml'), '<settings><x/></settings>');
      const changed = envOf(mavenCacheInputs(root, home, {}), 'M2_SETTINGS_FILE_SHA256');
      write(path.join(root, 'ci-settings.xml'), '<settings/>');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_SETTINGS_FILE_SHA256')[0]![1]).not.toBe(changed[0]![1]);
    });

    test('shouldHashGlobalSettingsFileWhenDashGsIsGiven', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project/>');
      write(path.join(root, 'global.xml'), '<settings/>');
      write(path.join(root, '.mvn', 'maven.config'), '-gs global.xml\n');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_GLOBAL_SETTINGS_FILE_SHA256')).toHaveLength(1);
    });

    test('shouldHashMavenHomeSettingsWhenMavenHomeIsSet', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project/>');
      const mavenHome = path.join(tmp, 'maven');
      write(path.join(mavenHome, 'conf', 'settings.xml'), '<settings/>');
      const got = envOf(mavenCacheInputs(root, home, { MAVEN_HOME: mavenHome }), 'M2_GLOBAL_SETTINGS_SHA256');
      expect(got).toHaveLength(1);
      expect(got[0]![1]).toMatch(/^[0-9a-f]{64}$/);
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_GLOBAL_SETTINGS_SHA256')).toEqual([]);
    });

    test('shouldHashUserExtensionsXmlWhenPresent', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project/>');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_EXTENSIONS_SHA256')).toEqual([]);
      write(path.join(home, '.m2', 'extensions.xml'), '<extensions/>');
      expect(envOf(mavenCacheInputs(root, home, {}), 'M2_EXTENSIONS_SHA256')).toHaveLength(1);
    });

    test('shouldKeepDigestInputsUnchangedWhenNoOptionalInputExists', () => {
      const { root, home } = project();
      write(path.join(root, 'pom.xml'), '<project/>');
      expect(mavenCacheInputs(root, home, {}).env.map(([k]) => k)).toEqual(['M2_LOCAL_REPO', 'M2_SETTINGS_SHA256']);
    });
  });
});

