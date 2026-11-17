import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { resolveWithResolutionCache } from '../../../../src/resolve-with-cache.js';

setDefaultTimeout(180_000);

/**
 * One reactor with: a module whose dependency cannot be resolved (`bad`), a healthy module
 * (`good`), and two modules that share the artifactId `core` under different groupIds.
 * The project is written to a temp dir at test time; the wrapper comes from `multi-module`.
 */
const wrapperSource = path.resolve(import.meta.dir, '../multi-module');
const scenarioReady = fs.existsSync(path.join(wrapperSource, '.mvn/wrapper/maven-wrapper.jar'));

function pom(groupId: string, artifactId: string, body = '', parent = ''): string {
  return `<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  ${parent}
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>1.0.0</version>
  ${body}
</project>
`;
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe.skipIf(!scenarioReady)('maven partial failure and duplicate artifactId', () => {
  let tmp = '';
  let root = '';

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-partial-'));
    root = fs.realpathSync(tmp);
    fs.cpSync(path.join(wrapperSource, '.mvn'), path.join(root, '.mvn'), { recursive: true });
    fs.copyFileSync(path.join(wrapperSource, 'mvnw'), path.join(root, 'mvnw'));
    fs.chmodSync(path.join(root, 'mvnw'), 0o755);
    write(
      path.join(root, 'pom.xml'),
      pom(
        'com.acme',
        'parent',
        '<packaging>pom</packaging><modules><module>good</module><module>bad</module>' +
          '<module>a/core</module><module>b/core</module></modules>',
      ),
    );
    const parent = '<parent><groupId>com.acme</groupId><artifactId>parent</artifactId><version>1.0.0</version></parent>';
    const props = '<properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties>';
    write(path.join(root, 'good', 'pom.xml'), pom('com.acme', 'good', props, parent));
    write(
      path.join(root, 'bad', 'pom.xml'),
      pom(
        'com.acme',
        'bad',
        `${props}<dependencies><dependency><groupId>com.jvmsrc.missing</groupId><artifactId>nope</artifactId><version>9.9.9</version></dependency></dependencies>`,
        parent,
      ),
    );
    const nestedParent = parent.replace('</parent>', '<relativePath>../../pom.xml</relativePath></parent>');
    write(path.join(root, 'a', 'core', 'pom.xml'), pom('com.a', 'core', props, nestedParent));
    write(path.join(root, 'b', 'core', 'pom.xml'), pom('com.b', 'core', props, nestedParent));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('shouldReportUnresolvableDependencyAsErrorAndStillResolveOtherModules', async () => {
    const resolved = await resolveWithResolutionCache(root, { forceRefresh: true });
    expect(resolved.ok ? 'ok' : resolved.message).toBe('ok');
    if (!resolved.ok) return;

    const bad = resolved.output.errors.filter((e) => e.module === 'bad');
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.message).toContain('com.jvmsrc.missing');
    expect(bad[0]!.fatal).toBe(false);
    const names = resolved.output.modules.map((m) => m.name);
    expect(names).toContain('good');
    expect(resolved.output.modules.find((m) => m.name === 'good')?.configurations.length).toBeGreaterThan(0);
  });

  test('shouldQualifyModuleNamesWhenTwoModulesShareAnArtifactId', async () => {
    const resolved = await resolveWithResolutionCache(root, { forceRefresh: false });
    expect(resolved.ok ? 'ok' : resolved.message).toBe('ok');
    if (!resolved.ok) return;
    const names = resolved.output.modules.map((m) => m.name);
    expect(names).toContain('com.a:core');
    expect(names).toContain('com.b:core');
    expect(names).not.toContain('core');
    expect(names).toContain('good');
  });
});
