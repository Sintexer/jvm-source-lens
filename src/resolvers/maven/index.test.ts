import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { findMavenBuildRoot, MavenResolver } from './index.js';

describe('MavenResolver detection and reactor root lifting', () => {
  let tmp = '';

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  test('detects pom.xml and rejects directories without pom.xml', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-det-'));
    const resolver = new MavenResolver();
    expect(resolver.detect(tmp)).toBe(false);

    fs.writeFileSync(path.join(tmp, 'pom.xml'), '<project/>', 'utf8');
    expect(resolver.detect(tmp)).toBe(true);
  });

  test('findMavenBuildRoot climbs nested aggregator pom.xml <modules> to reactor root without crossing into unrelated parent', () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-root-')));
    // Outer unrelated directory also has a pom.xml that does NOT list `reactor` in <modules>
    fs.writeFileSync(
      path.join(tmp, 'pom.xml'),
      '<project><modules><module>other</module></modules></project>',
      'utf8',
    );

    const reactor = path.join(tmp, 'reactor');
    const services = path.join(reactor, 'services');
    const appSrc = path.join(services, 'app', 'src', 'main', 'java');
    fs.mkdirSync(appSrc, { recursive: true });

    fs.writeFileSync(
      path.join(reactor, 'pom.xml'),
      '<project><modules><module>services</module></modules></project>',
      'utf8',
    );
    fs.writeFileSync(
      path.join(services, 'pom.xml'),
      '<project><modules><module>app</module></modules></project>',
      'utf8',
    );
    fs.writeFileSync(path.join(services, 'app', 'pom.xml'), '<project/>', 'utf8');

    expect(findMavenBuildRoot(appSrc)).toBe(reactor);
  });

  test('findMavenBuildRoot supports multi-segment <module>services/app</module> when intermediate directory has no pom.xml', () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvmsrc-mvn-multiseg-')));
    const reactor = path.join(tmp, 'reactor');
    const appSrc = path.join(reactor, 'services', 'app', 'src');
    fs.mkdirSync(appSrc, { recursive: true });

    fs.writeFileSync(
      path.join(reactor, 'pom.xml'),
      '<project><modules><module>services/app</module></modules></project>',
      'utf8',
    );
    fs.writeFileSync(path.join(reactor, 'services', 'app', 'pom.xml'), '<project/>', 'utf8');

    expect(findMavenBuildRoot(appSrc)).toBe(reactor);
  });
});
