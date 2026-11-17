import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  detectRequiredJavaVersion,
  gradleVersionToMaxJava,
  gradleVersionToMinJava,
  mavenVersionToMinJava,
  readMavenCompilerJavaVersion,
  readMavenWrapperMinJava,
} from './detect-required-version.js';

describe('gradleVersionToMinJava', () => {
  test('maps known Gradle baselines to minimum Java', () => {
    expect(gradleVersionToMinJava('7.4.2')).toBe(8);
    expect(gradleVersionToMinJava('8.7')).toBe(8);
    expect(gradleVersionToMinJava('8.8')).toBe(8);
    expect(gradleVersionToMinJava('8.11.1')).toBe(8);
    expect(gradleVersionToMinJava('9.0')).toBe(17);
  });
});

describe('gradleVersionToMaxJava', () => {
  test('maps older wrappers to conservative max Java', () => {
    expect(gradleVersionToMaxJava('7.4.2')).toBe(17);
    expect(gradleVersionToMaxJava('8.3')).toBe(20);
    expect(gradleVersionToMaxJava('8.6')).toBe(21);
    expect(gradleVersionToMaxJava('8.8')).toBe(22);
    expect(gradleVersionToMaxJava('8.11.1')).toBe(23);
    expect(gradleVersionToMaxJava('8.14')).toBe(24);
    expect(gradleVersionToMaxJava('9.0')).toBe(25);
  });

  test('returns null for invalid version strings', () => {
    expect(gradleVersionToMaxJava('not-a-version')).toBeNull();
  });
});

describe('Maven Java version detection', () => {
  test('mavenVersionToMinJava maps Maven 3.x to Java 8 and Maven 4+ to Java 17', () => {
    expect(mavenVersionToMinJava('3.8.8')).toBe(8);
    expect(mavenVersionToMinJava('3.9.9')).toBe(8);
    expect(mavenVersionToMinJava('4.0.0-rc-3')).toBe(17);
  });

  test('reads maven.compiler.release, 1.8 source, interpolated properties, and maven-compiler-plugin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-jdk-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'pom.xml'),
        [
          '<project>',
          '  <properties>',
          '    <jdk.target>21</jdk.target>',
          '    <maven.compiler.release>${jdk.target}</maven.compiler.release>',
          '  </properties>',
          '</project>',
        ].join('\n'),
        'utf8',
      );
      expect(readMavenCompilerJavaVersion(dir)).toBe(21);
      expect(detectRequiredJavaVersion(dir, { env: {} })).toEqual({
        source: 'toolchain-script',
        majorVersion: 21,
      });

      fs.writeFileSync(
        path.join(dir, 'pom.xml'),
        '<project><properties><maven.compiler.source>1.8</maven.compiler.source></properties></project>',
        'utf8',
      );
      expect(readMavenCompilerJavaVersion(dir)).toBe(8);

      fs.writeFileSync(
        path.join(dir, 'pom.xml'),
        [
          '<project><build><plugins><plugin>',
          '  <artifactId>maven-compiler-plugin</artifactId>',
          '  <configuration><release>17</release></configuration>',
          '</plugin></plugins></build></project>',
        ].join('\n'),
        'utf8',
      );
      expect(readMavenCompilerJavaVersion(dir)).toBe(17);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads Maven wrapper distributionUrl minimum Java when pom has no compiler property', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvnw-min-'));
    try {
      fs.writeFileSync(path.join(dir, 'pom.xml'), '<project/>', 'utf8');
      fs.mkdirSync(path.join(dir, '.mvn', 'wrapper'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.mvn', 'wrapper', 'maven-wrapper.properties'),
        'distributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/4.0.0-rc-3/apache-maven-4.0.0-rc-3-bin.zip\n',
        'utf8',
      );
      expect(readMavenWrapperMinJava(dir)).toBe(17);
      expect(detectRequiredJavaVersion(dir, { env: {} })).toEqual({
        source: 'maven-wrapper-inferred',
        majorVersion: 17,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
