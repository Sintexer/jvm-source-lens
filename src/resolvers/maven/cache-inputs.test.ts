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
});
