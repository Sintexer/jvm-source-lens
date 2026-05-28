import { expect, test } from 'bun:test';
import {
  mcpClassSourceToolPayloadSchema,
  mcpFindInClassSourcePayloadSchema,
  mcpGetClassStructurePayloadSchema,
  mcpGetMethodSignaturePayloadSchema,
  mcpListModulesPayloadSchema,
  mcpResolveDependenciesPayloadSchema,
  mcpSearchClassesPayloadSchema,
} from './mcp.js';
import {
  mcpToolResultFromFindInClassSource,
  mcpToolResultFromListModules,
  mcpToolResultFromMethodSignature,
  mcpToolResultFromResolutionResult,
  mcpToolResultFromSearchClasses,
} from './mcp-tool-result.js';

const outcomeOk = {
  querySucceeded: true as const,
  errorCategory: null,
};

const guidedFail = {
  message: 'Agent guidance for failure.',
  found: false as const,
  querySucceeded: false as const,
};

test('mcpFindInClassSourcePayloadSchema accepts success with hits', () => {
  const parsed = mcpFindInClassSourcePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'x.Y',
    query: 'needle',
    regex: false,
    sourceAvailable: true,
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a-sources.jar',
    },
    lineNumbersReliable: true,
    totalMatches: 1,
    hitCount: 1,
    truncated: false,
    hits: [
      {
        line: 10,
        column: 5,
        matchedText: 'needle',
        contextBefore: [],
        contextAfter: [],
      },
    ],
  });
  expect(parsed.success).toBe(true);
});

test('mcpToolResultFromFindInClassSource no-match is not MCP error (compact text)', () => {
  const r = mcpToolResultFromFindInClassSource(
    {
      ok: true,
      found: false,
      querySucceeded: true,
      className: 'x.Y',
      query: 'missing',
      regex: false,
      sourceAvailable: true,
      provenance: {
        kind: 'sourcesJar',
        coordinates: { group: 'g', name: 'a', version: '1' },
        jarPath: '/tmp/a-sources.jar',
      },
      message: 'Class x.Y was resolved, but no matches.',
    },
    { projectRoot: '/tmp/app', query: 'missing' },
  );
  expect(r.isError).toBe(false);
  expect(r.structuredContent).toBeUndefined();
  expect((r.content[0] as { text: string }).text).toContain('no matches');
  expect((r.content[0] as { text: string }).text).toContain('message:');
});

test('mcpClassSourceToolPayloadSchema accepts interproject provenance', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    source: 'package x;\npublic class Y {}\n',
    sourceAvailable: true,
    className: 'x.Y',
    provenance: {
      kind: 'interproject',
      coordinates: { group: 'root', name: 'lib', version: null },
      moduleName: ':lib',
      moduleRoot: '/tmp/proj/lib',
      sourceRelativePath: 'x/Y.java',
      absoluteSourcePath: '/tmp/proj/lib/src/main/java/x/Y.java',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetMethodSignaturePayloadSchema accepts interprojectBytecode provenance', () => {
  const parsed = mcpGetMethodSignaturePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'x.Y',
    methodName: 'run',
    methodFound: true,
    sourceAvailable: false,
    overloads: [],
    provenance: {
      kind: 'interprojectBytecode',
      coordinates: { group: 'root', name: 'lib', version: null },
      moduleName: ':lib',
      moduleRoot: '/tmp/proj/lib',
      classpathRoot: '/tmp/proj/lib/build/classes/java/main',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetMethodSignaturePayloadSchema accepts interprojectSource provenance', () => {
  const parsed = mcpGetMethodSignaturePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'x.Y',
    methodName: 'run',
    methodFound: true,
    sourceAvailable: true,
    overloads: [],
    provenance: {
      kind: 'interprojectSource',
      coordinates: { group: 'root', name: 'lib', version: null },
      moduleName: ':lib',
      moduleRoot: '/tmp/proj/lib',
      absoluteSourcePath: '/tmp/proj/lib/src/main/java/x/Y.java',
      sourceRelativePath: 'x/Y.java',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetMethodSignaturePayloadSchema accepts sourcesJar provenance', () => {
  const parsed = mcpGetMethodSignaturePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'g.a.Foo',
    methodName: 'bar',
    methodFound: false,
    sourceAvailable: true,
    overloads: [],
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a-sources.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetClassStructurePayloadSchema accepts interprojectBytecode provenance', () => {
  const parsed = mcpGetClassStructurePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'x.Y',
    kind: 'class',
    superclass: 'java.lang.Object',
    interfaces: [],
    typeParameters: [],
    fields: [],
    methods: [],
    sourceAvailable: true,
    provenance: {
      kind: 'interprojectBytecode',
      coordinates: { group: 'root', name: 'lib', version: null },
      moduleName: ':lib',
      moduleRoot: '/tmp/proj/lib',
      classpathRoot: '/tmp/proj/lib/build/classes/java/main',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetClassStructurePayloadSchema accepts interprojectSource provenance', () => {
  const parsed = mcpGetClassStructurePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'x.Y',
    kind: 'class',
    superclass: 'java.lang.Object',
    interfaces: [],
    typeParameters: [],
    fields: [],
    methods: [],
    sourceAvailable: true,
    provenance: {
      kind: 'interprojectSource',
      coordinates: { group: 'root', name: 'lib', version: null },
      moduleName: ':lib',
      moduleRoot: '/tmp/proj/lib',
      absoluteSourcePath: '/tmp/proj/lib/src/main/java/x/Y.java',
      sourceRelativePath: 'x/Y.java',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpClassSourceToolPayloadSchema accepts success with found=true', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    source: 'public class T {}',
    sourceAvailable: true,
    className: 'com.example.T',
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a-sources.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpClassSourceToolPayloadSchema accepts not-found payload', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: true,
    found: false,
    className: 'com.example.Missing',
    searchedArtifactCount: 3,
    querySucceeded: true,
    code: 'CLASS_NOT_FOUND',
    message: 'Classpath resolved; class absent.',
    errorCategory: null,
  });
  expect(parsed.success).toBe(true);
});

test('mcpClassSourceToolPayloadSchema accepts categorized failure', () => {
  const parsed = mcpClassSourceToolPayloadSchema.safeParse({
    ok: false,
    code: 'INVALID_FQN',
    errorCategory: 'validation',
    isRetryable: true,
    ...guidedFail,
    message: 'Fix the class name.',
    error: { code: 'INVALID_FQN', message: 'bad' },
  });
  expect(parsed.success).toBe(true);
});

test('mcpListModulesPayloadSchema accepts success payload', () => {
  const parsed = mcpListModulesPayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    projectRoot: '/tmp/proj',
    resolvedAt: '2026-05-15T12:00:00Z',
    schemaVersion: '1.1',
    buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
    modules: [
      {
        name: ':app',
        path: '/tmp/proj/app',
        configurations: [
          {
            name: 'compileClasspath',
            scope: 'compile',
            artifactCount: 2,
            directArtifactCount: 1,
          },
        ],
      },
    ],
    resolutionWarningCount: 0,
  });
  expect(parsed.success).toBe(true);
});

test('mcpListModulesPayloadSchema accepts RESOLUTION_FAILED failure', () => {
  const parsed = mcpListModulesPayloadSchema.safeParse({
    ok: false,
    code: 'RESOLUTION_FAILED',
    errorCategory: 'validation',
    isRetryable: true,
    ...guidedFail,
    message: 'Not Gradle.',
    error: { code: 'RESOLUTION_FAILED', message: 'Not Gradle.' },
  });
  expect(parsed.success).toBe(true);
});

test('mcpSearchClassesPayloadSchema accepts default compact success payload', () => {
  const parsed = mcpSearchClassesPayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    query: 'Repository',
    limit: 50,
    totalMatches: 2,
    hitCount: 2,
    hits: [
      { className: 'com.example.FooRepository', libName: 'spring-data-jpa' },
      { className: 'com.example.BarRepository', libName: ':core' },
    ],
  });
  expect(parsed.success).toBe(true);
});

test('mcpSearchClassesPayloadSchema accepts include all full hit payload', () => {
  const parsed = mcpSearchClassesPayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    query: 'Repository',
    limit: 50,
    totalMatches: 1,
    hitCount: 1,
    hits: [
      {
        className: 'com.example.FooRepository',
        libName: 'a',
        simpleName: 'FooRepository',
        moduleName: 'root',
        configurationName: 'compileClasspath',
        origin: 'external',
        coordinates: { group: 'g', name: 'a', version: '1' },
        jarPath: '/tmp/a.jar',
        moduleRoot: null,
        interprojectModuleName: null,
        score: 8_000_000,
      },
    ],
    indexMeta: {
      indexFormatVersion: 3,
      buildInputsDigest: 'abc',
      resolutionFingerprint: 'def',
      moduleName: 'root',
      configurationName: 'compileClasspath',
      includeTest: false,
      builtAt: '2026-05-15T12:00:00Z',
      entryCount: 100,
      skippedArtifacts: 0,
      sourceEnrichedEntries: 12,
      sourceEnrichmentBytesCap: 262144,
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpToolResultFromSearchClasses compact omits jar paths', () => {
  const r = mcpToolResultFromSearchClasses(
    {
      ok: true,
      query: 'X',
      limit: 10,
      totalMatches: 1,
      hits: [
        {
          className: 'a.b.X',
          simpleName: 'X',
          moduleName: 'root',
          configurationName: 'compileClasspath',
          origin: 'external',
          coordinates: { group: 'g', name: 'n', version: null },
          jarPath: '/home/user/.gradle/caches/j.jar',
          moduleRoot: null,
          interprojectModuleName: null,
          score: 10_000_000,
        },
      ],
      indexMeta: {
        indexFormatVersion: 3,
        buildInputsDigest: 'a',
        resolutionFingerprint: 'b',
        moduleName: 'root',
        configurationName: 'compileClasspath',
        includeTest: false,
        builtAt: '2026-05-15T12:00:00Z',
        entryCount: 1,
        skippedArtifacts: 0,
        sourceEnrichedEntries: 1,
        sourceEnrichmentBytesCap: 262144,
      },
    },
    { projectRoot: '/p', query: 'X' },
  );
  expect(r.isError).toBe(false);
  const text = r.content[0]?.type === 'text' ? r.content[0].text : '';
  expect(text).toContain('a.b.X');
  expect(text).toContain('n');
  expect(text).not.toContain('/home/user/.gradle');
});

test('mcpToolResultFromSearchClasses full json default projection', () => {
  const r = mcpToolResultFromSearchClasses(
    {
      ok: true,
      query: 'X',
      limit: 10,
      totalMatches: 1,
      hits: [
        {
          className: 'a.b.X',
          simpleName: 'X',
          moduleName: 'root',
          configurationName: 'compileClasspath',
          origin: 'external',
          coordinates: { group: 'g', name: 'n', version: null },
          jarPath: '/j.jar',
          moduleRoot: null,
          interprojectModuleName: null,
          score: 10_000_000,
        },
      ],
      indexMeta: {
        indexFormatVersion: 3,
        buildInputsDigest: 'a',
        resolutionFingerprint: 'b',
        moduleName: 'root',
        configurationName: 'compileClasspath',
        includeTest: false,
        builtAt: '2026-05-15T12:00:00Z',
        entryCount: 1,
        skippedArtifacts: 0,
        sourceEnrichedEntries: 1,
        sourceEnrichmentBytesCap: 262144,
      },
    },
    { projectRoot: '/p', query: 'X', full: true },
  );
  expect(r.isError).toBe(false);
  const sc = r.structuredContent as Record<string, unknown>;
  expect(sc.indexMeta).toBeUndefined();
  const hits = sc.hits as Array<Record<string, unknown>>;
  expect(hits[0]).toEqual({ className: 'a.b.X', libName: 'n' });
});

test('mcpToolResultFromListModules success compact text by default', () => {
  const result = mcpToolResultFromListModules(
    {
      ok: true,
      output: {
        schemaVersion: '1.1',
        resolvedAt: '2026-05-15T12:00:00Z',
        buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
        projectRoot: '/tmp/proj',
        modules: [
          {
            name: ':app',
            path: '/tmp/proj/app',
            configurations: [
              {
                name: 'compileClasspath',
                scope: 'compile',
                artifacts: [],
              },
            ],
          },
        ],
        errors: [],
      },
    },
    '/tmp/proj',
  );
  expect(result.isError).toBe(false);
  expect(result.structuredContent).toBeUndefined();
  expect((result.content[0] as { text: string }).text).toContain(':app');
});

test('mcpToolResultFromListModules full=true returns JSON', () => {
  const result = mcpToolResultFromListModules(
    {
      ok: true,
      output: {
        schemaVersion: '1.1',
        resolvedAt: '2026-05-15T12:00:00Z',
        buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
        projectRoot: '/tmp/proj',
        modules: [
          {
            name: ':app',
            path: '/tmp/proj/app',
            configurations: [
              {
                name: 'compileClasspath',
                scope: 'compile',
                artifacts: [],
              },
            ],
          },
        ],
        errors: [],
      },
    },
    '/tmp/proj',
    true,
  );
  expect(result.structuredContent).toMatchObject({
    ok: true,
    projectRoot: '/tmp/proj',
    modules: [{ name: ':app', configurations: [{ artifactCount: 0, directArtifactCount: 0 }] }],
    resolutionWarningCount: 0,
  });
});

test('mcpToolResultFromListModules failure matches resolve_dependencies failure shape', () => {
  const result = mcpToolResultFromListModules({ ok: false, message: 'boom' }, '/tmp/bad');
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    code: 'RESOLUTION_FAILED',
    error: { code: 'RESOLUTION_FAILED', message: 'boom' },
  });
});

test('mcpResolveDependenciesPayloadSchema accepts success with resolution', () => {
  const parsed = mcpResolveDependenciesPayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    resolution: {
      schemaVersion: '1.1',
      resolvedAt: '2026-05-15T12:00:00Z',
      buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
      projectRoot: '/tmp/proj',
      modules: [],
      errors: [],
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpResolveDependenciesPayloadSchema accepts RESOLUTION_FAILED failure', () => {
  const parsed = mcpResolveDependenciesPayloadSchema.safeParse({
    ok: false,
    code: 'RESOLUTION_FAILED',
    errorCategory: 'transient',
    isRetryable: true,
    ...guidedFail,
    message: 'Gradle failed.',
    error: { code: 'RESOLUTION_FAILED', message: 'Gradle failed.' },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetMethodSignaturePayloadSchema accepts IDE-minimal overloads (source path)', () => {
  const parsed = mcpGetMethodSignaturePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'com.example.Foo',
    methodName: 'bar',
    methodFound: true,
    sourceAvailable: true,
    overloads: [
      {
        declarationLine: 'public void bar(int x);',
        visibility: 'public',
        returnTypeDisplay: 'void',
        parameters: [{ name: 'x', typeDisplay: 'int' }],
        thrownExceptions: [],
      },
    ],
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a-sources.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetMethodSignaturePayloadSchema accepts success with overloads', () => {
  const parsed = mcpGetMethodSignaturePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'java.lang.String',
    methodName: 'substring',
    methodFound: true,
    sourceAvailable: false,
    overloads: [
      {
        declarationLine: 'public java.lang.String substring(int);',
        visibility: 'public',
        jvmDescriptor: '(I)Ljava/lang/String;',
        genericSignature: null,
        returnTypeDisplay: 'java.lang.String',
        parameters: [{ name: 'beginIndex', typeDisplay: 'int' }],
        thrownExceptions: [],
        flagsLine: '(0x0001) ACC_PUBLIC',
      },
    ],
    provenance: {
      kind: 'classpathJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetMethodSignaturePayloadSchema accepts SIGNATURE_EXTRACT_FAILED failure', () => {
  const parsed = mcpGetMethodSignaturePayloadSchema.safeParse({
    ok: false,
    code: 'SIGNATURE_EXTRACT_FAILED',
    errorCategory: 'business',
    isRetryable: false,
    ...guidedFail,
    message: 'javap failed.',
    error: {
      code: 'SIGNATURE_EXTRACT_FAILED',
      message: 'javap exited',
      className: 'a.B',
      methodName: 'm',
      jarPath: '/x.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetClassStructurePayloadSchema accepts success', () => {
  const parsed = mcpGetClassStructurePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'com.example.T',
    kind: 'class',
    superclass: 'com.example.Base',
    interfaces: ['java.io.Serializable'],
    typeParameters: ['T'],
    fields: [],
    methods: [
      {
        name: 'foo',
        jvmMethodName: 'foo',
        declaringClass: 'com.example.T',
        visibility: 'public',
        returnType: 'void',
        parameters: [],
        typeParameters: [],
        javadoc: null,
        abstract: false,
        static: false,
        throws: [],
        genericSignature: null,
        jvmDescriptor: null,
        inherited: false,
      },
    ],
    sourceAvailable: false,
    provenance: {
      kind: 'classpathJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetClassStructurePayloadSchema accepts hierarchy and annotations enrichments', () => {
  const parsed = mcpGetClassStructurePayloadSchema.safeParse({
    ok: true,
    found: true,
    ...outcomeOk,
    className: 'com.example.T',
    kind: 'class',
    superclass: 'com.example.Base',
    interfaces: [],
    typeParameters: [],
    fields: [
      {
        name: 'id',
        declaringClass: 'com.example.T',
        visibility: 'private',
        type: 'long',
        static: false,
        final: false,
        enumConstant: false,
        javadoc: null,
        annotations: [{ summary: 'jakarta.persistence.Id' }],
      },
    ],
    methods: [
      {
        name: 'run',
        jvmMethodName: 'run',
        declaringClass: 'com.example.T',
        visibility: 'public',
        returnType: 'void',
        parameters: [],
        typeParameters: [],
        javadoc: null,
        abstract: false,
        static: false,
        throws: [],
        genericSignature: null,
        jvmDescriptor: '()V',
        inherited: false,
        annotations: [{ summary: 'java.lang.Deprecated' }],
      },
    ],
    sourceAvailable: true,
    provenance: {
      kind: 'sourcesJar',
      coordinates: { group: 'g', name: 'a', version: '1' },
      jarPath: '/tmp/a-sources.jar',
    },
    typeHierarchy: {
      superclassChain: [
        { className: 'com.example.T', kind: 'class' },
        { className: 'com.example.Base', kind: 'class' },
      ],
      allSuperinterfaces: ['java.lang.Runnable'],
    },
    classAnnotations: [{ summary: 'java.lang.SuppressWarnings("unchecked")' }],
  });
  expect(parsed.success).toBe(true);
});

test('mcpGetClassStructurePayloadSchema accepts SIGNATURE_EXTRACT_FAILED without methodName', () => {
  const parsed = mcpGetClassStructurePayloadSchema.safeParse({
    ok: false,
    code: 'SIGNATURE_EXTRACT_FAILED',
    errorCategory: 'business',
    isRetryable: false,
    ...guidedFail,
    message: 'javap failed.',
    error: {
      code: 'SIGNATURE_EXTRACT_FAILED',
      message: 'javap exited',
      className: 'a.B',
      jarPath: '/x.jar',
    },
  });
  expect(parsed.success).toBe(true);
});

test('mcpToolResultFromMethodSignature CLASS_NOT_FOUND is not MCP error', () => {
  const r = mcpToolResultFromMethodSignature(
    {
      ok: false,
      error: {
        code: 'CLASS_NOT_FOUND',
        message: 'missing',
        className: 'com.example.Missing',
        searchedArtifactCount: 4,
      },
    },
    { projectRoot: '/tmp/app', methodName: 'run', full: true },
  );
  expect(r.isError).toBe(false);
  const sc = r.structuredContent as { found: boolean; methodName: string; message: string };
  expect(sc.found).toBe(false);
  expect(sc.methodName).toBe('run');
});

test('mcpToolResultFromMethodSignature timeout-like SIGNATURE_EXTRACT_FAILED is transient', () => {
  const r = mcpToolResultFromMethodSignature(
    {
      ok: false,
      error: {
        code: 'SIGNATURE_EXTRACT_FAILED',
        message: 'javap timed out after 100ms',
        className: 'a.B',
        methodName: 'm',
        jarPath: '/x.jar',
      },
    },
    { projectRoot: '/tmp/app', methodName: 'm' },
  );
  expect(r.isError).toBe(true);
  const sc = r.structuredContent as { errorCategory: string; isRetryable: boolean };
  expect(sc.errorCategory).toBe('transient');
  expect(sc.isRetryable).toBe(true);
});

test('mcpToolResultFromResolutionResult success compact text by default', () => {
  const result = mcpToolResultFromResolutionResult(
    {
      ok: true,
      output: {
        schemaVersion: '1.1',
        resolvedAt: '2026-05-15T12:00:00Z',
        buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
        projectRoot: '/tmp/proj',
        modules: [{ name: ':app', path: '/tmp/proj/app', configurations: [] }],
        errors: [],
      },
    },
    '/tmp/proj',
  );
  expect(result.isError).toBe(false);
  expect(result.structuredContent).toBeUndefined();
  expect((result.content[0] as { text: string }).text).toContain(':app');
});

test('mcpToolResultFromResolutionResult full=true returns resolution JSON', () => {
  const result = mcpToolResultFromResolutionResult(
    {
      ok: true,
      output: {
        schemaVersion: '1.1',
        resolvedAt: '2026-05-15T12:00:00Z',
        buildSystem: { type: 'gradle', version: '8.7', wrapper: true },
        projectRoot: '/tmp/proj',
        modules: [{ name: ':app', path: '/tmp/proj/app', configurations: [] }],
        errors: [],
      },
    },
    '/tmp/proj',
    true,
  );
  expect(result.structuredContent).toMatchObject({
    ok: true,
    found: true,
    querySucceeded: true,
    errorCategory: null,
    resolution: expect.objectContaining({ projectRoot: '/tmp/proj', modules: expect.any(Array) }),
  });
  expect((result.structuredContent as { message?: string }).message).toBeUndefined();
});

test('mcpToolResultFromResolutionResult failure sets isError true', () => {
  const result = mcpToolResultFromResolutionResult(
    { ok: false, message: 'Not a Gradle project' },
    '/tmp/bad',
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    code: 'RESOLUTION_FAILED',
    error: { code: 'RESOLUTION_FAILED', message: 'Not a Gradle project' },
  });
});
