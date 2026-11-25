import { expect, spyOn, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as signatures from './get-method-signatures.js';
import * as bytecode from './get-method-signatures-bytecode.js';
import { createMcpServer } from './mcp.js';
import { mcpToolResultFromClassStructure, mcpToolResultFromMethodSignature } from './mcp-tool-result.js';

const className = 'example.Widget';
const docsSource = 'javadoc-jar' as const;
const provenance = { kind: 'classpathJar' as const, coordinates: { group: 'g', name: 'a', version: '1' }, jarPath: '/lib/a.jar' };
const query = { projectRoot: `${import.meta.dir}/../test/fixtures/gradle-smoke`, methodName: 'lookup' };
const overload = {
  declarationLine: 'public void lookup();', visibility: 'public' as const, returnTypeDisplay: 'void',
  parameters: [], thrownExceptions: [], flagsLine: null, genericSignature: null, jvmDescriptor: '()V',
};
const signature = {
  ok: true as const, className, methodName: query.methodName, methodFound: true, sourceAvailable: false, provenance,
  overloads: [overload, { ...overload, declarationLine: 'public void lookup(int);', jvmDescriptor: '(I)V',
    parameters: [{ name: null, typeDisplay: 'int' }], javadoc: 'Looks up by index.', docsSource }],
};

test.each([true, false])('overload docs stay on their matching declaration (sourceAvailable=%s)', (sourceAvailable) => {
  const result = { ...signature, sourceAvailable };
  const compact = mcpToolResultFromMethodSignature(result, query);
  const block = compact.content[0];
  expect(block?.type === 'text' && block.text).toContain('lookup()\n  P void lookup(int)\n    Looks up by index. (javadoc-jar)');
  const full = mcpToolResultFromMethodSignature(result, { ...query, full: true });
  expect(full.structuredContent?.overloads).toEqual([
    { declarationLine: overload.declarationLine },
    { declarationLine: 'public void lookup(int);', javadoc: 'Looks up by index.', docsSource },
  ]);
});

test('overview identifies the purpose source; declared and effective also identify member docs', () => {
  const method = { name: 'run', jvmMethodName: 'run', declaringClass: className, visibility: 'public' as const,
    returnType: 'void', parameters: [], typeParameters: [], throws: [], abstract: false, static: false,
    genericSignature: null, jvmDescriptor: '()V', inherited: false, javadoc: 'Runs a widget.', docsSource };
  const field = { name: 'id', declaringClass: className, visibility: 'public' as const, type: 'int',
    static: false, final: true, enumConstant: false, javadoc: 'Widget id.', docsSource };
  const structure = { ok: true as const, className, kind: 'class' as const, superclass: null, interfaces: [],
    typeParameters: [], fields: [field], methods: [method], classPurpose: 'A widget.', docsSource, sourceAvailable: false, provenance };
  for (const scope of ['overview', 'declared', 'effective'] as const) {
    const block = mcpToolResultFromClassStructure(structure, { ...query, scope }).content[0];
    const text = block?.type === 'text' && block.text;
    const full = mcpToolResultFromClassStructure(structure, { ...query, scope, full: true }).structuredContent;
    expect(text).toContain('Purpose: A widget. (javadoc-jar)');
    expect(full).toMatchObject({ classPurpose: structure.classPurpose, docsSource, sourceAvailable: false });
    if (scope === 'overview') {
      expect(text).not.toContain(field.javadoc);
      expect(text).not.toContain(method.javadoc);
      expect(full?.declaredMethods).toBeUndefined();
      expect(full?.fields).toBeUndefined();
    } else {
      expect(text).toContain('int id\n    Widget id. (javadoc-jar)');
      expect(text).toContain('void run()\n    Runs a widget. (javadoc-jar)');
      expect(full?.declaredMethods).toMatchObject([{ name: 'run', javadoc: method.javadoc, docsSource }]);
      expect(full?.fields).toEqual([field]);
    }
  }
  const constants = { ...structure, fields: Array.from({ length: 8 }, (_, i) => ({ ...field, name: `ID_${i}` })) };
  const overview = mcpToolResultFromClassStructure(constants, { ...query, full: true });
  expect(overview.structuredContent?.fields).toMatchObject(constants.fields.map(({ name }) => ({ name, javadoc: null })));
  expect(JSON.stringify(overview.structuredContent?.fields)).not.toContain('docsSource');
});

test('multi-method requests share one cache, keep structured results, and bypass docs for bytecodeOnly', async () => {
  const run = { ...overload, declarationLine: 'public void run();', javadoc: 'Runs once.', docsSource };
  const normal = spyOn(signatures, 'getMethodSignatures').mockImplementation(async (_, methodName) =>
    methodName === 'lookup' ? signature : { ...signature, methodName, overloads: [run] });
  const raw = spyOn(bytecode, 'getMethodSignaturesBytecode').mockResolvedValue({ ...signature, overloads: [overload] });
  const server = createMcpServer();
  const client = new Client({ name: 'javadoc-test', version: '1' });
  try {
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);
    const args = { projectRoot: query.projectRoot, className, methodNames: ['lookup', 'run'], full: true };
    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({ name: 'get_method_signature', arguments: args });
      expect(result.structuredContent).toMatchObject({ results: [
        { methodName: 'lookup', overloads: [{ declarationLine: overload.declarationLine }, { javadoc: 'Looks up by index.', docsSource }] },
        { methodName: 'run', overloads: [{ declarationLine: run.declarationLine, javadoc: run.javadoc, docsSource }] },
      ] });
    }
    const caches = normal.mock.calls.map(([, , opts]) => opts?.javadocCache);
    expect(caches).toHaveLength(4);
    expect(caches[0]).toBeInstanceOf(Map);
    expect(caches[0]).toBe(caches[1]);
    expect(caches[2]).toBeInstanceOf(Map);
    expect(caches[2]).toBe(caches[3]);
    expect(caches[0]).not.toBe(caches[2]);
    await client.callTool({ name: 'get_method_signature', arguments: { ...args, bytecodeOnly: true } });
    expect(raw).toHaveBeenCalledTimes(2);
    expect(normal).toHaveBeenCalledTimes(4);
    for (const [, , opts] of raw.mock.calls) expect(opts).not.toHaveProperty('javadocCache');
  } finally {
    normal.mockRestore();
    raw.mockRestore();
    await client.close();
    await server.close();
  }
});
