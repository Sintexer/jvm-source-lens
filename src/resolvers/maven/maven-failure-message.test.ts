import { describe, expect, test } from 'bun:test';
import { formatMavenUserMessage } from './maven-failure-message.js';

describe('formatMavenUserMessage', () => {
  test('shouldAppendTimeoutHintOnTimeout', () => {
    const m = formatMavenUserMessage({
      kind: 'timeout',
      message: 'Maven timed out after 1000ms',
      command: ['/p/mvnw'],
      usedWrapper: true,
    });
    expect(m).toContain('Maven timed out');
    expect(m).toContain('JVMSRC_MAVEN_TIMEOUT_MS');
  });

  test('shouldSuggestPathOrMvnwWhenSystemMvnSpawnFails', () => {
    const m = formatMavenUserMessage({
      kind: 'spawn',
      message: 'Failed to start Maven (mvn): ENOENT',
      command: ['mvn'],
      usedWrapper: false,
    });
    expect(m).toContain('MAVEN_HOME');
    expect(m).toContain('mvnw');
  });

  test('shouldLeaveWrapperSpawnFailureUnchanged', () => {
    const base = 'Failed to start Maven (/p/mvnw): EACCES';
    const m = formatMavenUserMessage({
      kind: 'spawn',
      message: base,
      command: ['/p/mvnw'],
      usedWrapper: true,
    });
    expect(m).toBe(base);
  });

  test('shouldAppendOfflineHintWhenArtifactUncachedInOfflineMode', () => {
    const m = formatMavenUserMessage({
      kind: 'exit',
      message: 'Maven exited with code 1',
      stderr:
        '[ERROR] Cannot access central (https://repo.maven.apache.org/maven2) in offline mode and the artifact com.example:foo:jar:1.0 has not been downloaded from it before.',
      command: ['/p/mvnw'],
      usedWrapper: true,
    });
    expect(m).toContain('offline mode');
    expect(m).toContain('.mvn/maven.config');
  });

  test('shouldAppendSettingsXmlServersHintOn401Or403AuthFailure', () => {
    const m = formatMavenUserMessage({
      kind: 'exit',
      message: 'Maven exited with code 1',
      stderr:
        '[ERROR] Failed to collect dependencies at com.corp:sdk:jar:2.0: status code: 401, reason phrase: Unauthorized (401)',
      command: ['/p/mvnw'],
      usedWrapper: true,
    });
    expect(m).toContain('settings.xml');
    expect(m).toContain('<servers>');
  });

  test('shouldAppendMissingArtifactHintWhenArtifactDoesNotExist', () => {
    const m = formatMavenUserMessage({
      kind: 'exit',
      message: 'Maven exited with code 1',
      stderr: '[ERROR] Could not find artifact com.example:nonexistent:jar:9.9.9 in central',
      command: ['/p/mvnw'],
      usedWrapper: true,
    });
    expect(m).toContain('pom.xml');
    expect(m).toContain('<repositories>');
  });

  test('shouldAppendJavaHomeHintOnJdkVersionMismatch', () => {
    const m = formatMavenUserMessage({
      kind: 'exit',
      message: 'Maven exited with code 1',
      stdout: '[ERROR] Fatal error compiling: error: release version 25 not supported',
      command: ['/p/mvnw'],
      usedWrapper: true,
    });
    expect(m).toContain('Java 25');
    expect(m).toContain('JVMSRC_JAVA_HOME');
  });

  test.each([
    'Could not transfer artifact g:a:1 from/to corp (https://x/y): status code: 401, reason phrase: Unauthorized',
    'Return code is: 403 , ReasonPhrase: Forbidden.',
    'Failed to read artifact descriptor: 401 Unauthorized',
    'transfer failed: HTTP 403',
  ])('shouldAppendAuthHintWhenLogShowsHttpAuthFailure %#', (line) => {
    const m = formatMavenUserMessage({ kind: 'exit', message: 'Maven exited with code 1', stderr: line, command: ['mvn'], usedWrapper: false });
    expect(m).toContain('private repository authentication failed');
  });

  test.each([
    '[ERROR] /p/src/Main.java:[401,12] cannot find symbol',
    'Total time: 4012 ms, listening on port 403',
    'Downloaded 401 artifacts in 12 s',
  ])('shouldNotAppendAuthHintWhenNumberIsNotAnHttpStatus %#', (line) => {
    const m = formatMavenUserMessage({ kind: 'exit', message: 'Maven exited with code 1', stderr: line, command: ['mvn'], usedWrapper: false });
    expect(m).not.toContain('private repository authentication failed');
  });
});

