import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp.js';

type ToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] };
};

let client: Client;
let tools: ToolInfo[];

beforeAll(async () => {
  const server = createMcpServer();
  client = new Client({ name: 'schema-test', version: '0.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  tools = (await client.listTools()).tools as ToolInfo[];
});

const props = (name: string) => Object.keys(tools.find((t) => t.name === name)!.inputSchema.properties ?? {});

describe('advertised input schemas', () => {
  test('no tool advertises full, include, or the legacy methodName', () => {
    for (const t of tools) {
      const names = props(t.name);
      expect(names).not.toContain('full');
      expect(names).not.toContain('include');
      expect(names).not.toContain('methodName');
    }
  });

  test('projectRoot is optional everywhere', () => {
    for (const t of tools) {
      expect(t.inputSchema.required ?? []).not.toContain('projectRoot');
    }
  });

  test('every advertised parameter has a description', () => {
    for (const t of tools) {
      for (const [name, def] of Object.entries(t.inputSchema.properties ?? {})) {
        expect(`${t.name}.${name}: ${def.description ?? ''}`).not.toBe(`${t.name}.${name}: `);
      }
    }
  });

  test('schemas carry no $schema, empty additionalProperties, or safe-integer maximum', () => {
    const raw = JSON.stringify(tools.map((t) => t.inputSchema));
    expect(raw).not.toContain('$schema');
    expect(raw).not.toContain('additionalProperties');
    expect(raw).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });

  test('seldom-used parameters are not advertised', () => {
    for (const t of tools) {
      const names = props(t.name);
      expect(names).not.toContain('projectRoot');
      expect(names).not.toContain('configuration');
      expect(names).not.toContain('maxClasses');
      if (t.name !== 'resolve_dependencies') {
        expect(names).not.toContain('forceRefresh');
      }
    }
    expect(props('resolve_dependencies')).toContain('forceRefresh');
  });

  test('scope does not offer "full"', () => {
    const scope = tools.find((t) => t.name === 'get_class_structure')!.inputSchema.properties!.scope as {
      enum?: string[];
    };
    expect(scope.enum).toEqual(['overview', 'declared', 'effective']);
  });

  test('server instructions and tool titles/descriptions stay byte-identical', () => {
    expect(client.getInstructions()).toBe(
      "\njvmsrc reads third-party JVM dependencies: classes inside JARs on a Gradle project's classpath\n" +
        '(structure, signatures, source, versions). Gradle projects only.\n\n' +
        'Use it instead of memory, web search, or javap/unzip/Gradle-cache digging for any question about\n' +
        'a library class, method, or version — "what does X do", "which JAR has Y", NoSuchMethodError,\n' +
        "ClassCastException, version conflicts. Code under this repo's src/ → grep/read instead.\n\n" +
        'Flow: search_classes (only if the name is unknown) → get_class_structure → get_class_source with\n' +
        'methodNames. For version problems start with resolve_dependencies.\n\n' +
        "When you are working inside a specific module, pass modulePath (':app', or the\n" +
        "file you are editing) so you get that module's dependency versions; otherwise omit it to search\n" +
        'all modules. If a call fails, fix the arguments as the error says and retry; never fall back to\n' +
        'javap/unzip.\n\n' +
        'Declaration lines use short modifiers: P=public p=private prot=protected pack=package-private\n' +
        's=static f=final a=abstract (e.g. "Psf long ZERO").\n',
    );

    expect(
      tools.map((t) => ({ name: t.name, title: t.title, description: t.description })),
    ).toEqual([
      {
        name: 'get_class_source',
        title: 'Get Java source for a class',
        description:
          "Read a dependency class's Java source, ideally only specific methods via methodNames (or startLine/endLine; Scala/Groovy: startLine/endLine only). Use only when you need the implementation, not names or signatures. Sources JAR if present, else decompiled (sourceAvailable=false). Whole files over ~64KiB are refused: pass methodNames.",
      },
      {
        name: 'find_in_class_source',
        title: 'Find text in resolved Java source',
        description:
          "Grep one known dependency class's source for a string, identifier, or pattern (literal; regex optional). Unknown class: search_classes. Whole JAR: search_in_artifact.",
      },
      {
        name: 'resolve_dependencies',
        title: 'Resolve Gradle dependencies',
        description:
          'List Gradle modules and, with query, the exact dependency versions on the classpath with module counts (conflicts flagged); add modules to name the modules (a path filter, or "all"). Start here for NoSuchMethodError, AbstractMethodError, ClassCastException, or "which version of X is used?"; use instead of reading Gradle files or ~/.gradle caches.',
      },
      {
        name: 'search_classes',
        title: 'Search classes on the resolved classpath',
        description:
          'Find which dependency JAR provides a class when you only have a simple name, partial name, or keyword (e.g. ObjectMapper, retry). Use for unknown types in stack traces or imports, instead of unzip/jar searches. Returns FQN + library per hit; next call get_class_structure.',
      },
      {
        name: 'get_method_signature',
        title: 'Get Java method overload signatures',
        description:
          'List every overload (parameters, generics, return type) of one or more methods or constructors ("<init>") of a dependency class. Use to verify a call or pick an overload. Not for bodies: use get_class_source.',
      },
      {
        name: 'get_class_structure',
        title: 'Get structured Java class API',
        description:
          "Show what a third-party library (JAR) class is and does: purpose and method names; scope=declared adds all signatures and fields, scope=effective adds inherited members. First call for any dependency class you can name; use instead of reading source or javap. One method's overloads: get_method_signature.",
      },
      {
        name: 'search_in_artifact',
        title: 'Search text across all classes in one resolved dependency JAR',
        description:
          'Grep every class in one dependency JAR for a string (log message, exception text, constant). Use when you know the library but not the class. Pass coordinates {group, name, version} (see resolve_dependencies with query) or jarPath.',
      },
    ]);
  });
});

describe('tolerated inputs', () => {
  const missingRoot = '/nonexistent-jvmsrc-project';
  // The compact text is a one-line summary; guidance lives in structuredContent / message.
  const text = (r: unknown) => JSON.stringify(r);

  test.each([
    ['string methodNames', { methodNames: 'foo' }],
    ['array methodNames', { methodNames: ['foo', 'bar'] }],
    ['legacy methodName', { methodName: 'foo' }],
  ])('get_method_signature accepts %s (fails later, on the project root)', async (_label, extra) => {
    const r = await client.callTool({
      name: 'get_method_signature',
      arguments: { className: 'a.B', projectRoot: missingRoot, ...extra },
    });
    expect(text(r)).toContain('does not exist');
  });

  test('get_method_signature without any method name is a validation error', async () => {
    const r = await client.callTool({
      name: 'get_method_signature',
      arguments: { className: 'a.B', projectRoot: missingRoot },
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(text(r)).toContain('Provide methodNames');
  });

  test('hidden full / include are accepted and ignored by validation', async () => {
    const r = await client.callTool({
      name: 'get_class_structure',
      arguments: { className: 'a.B', projectRoot: missingRoot, full: true, include: ['fields'] },
    });
    expect(text(r)).toContain('does not exist');
  });

  test('unadvertised configuration / forceRefresh / maxClasses are still accepted', async () => {
    const r = await client.callTool({
      name: 'search_in_artifact',
      arguments: {
        query: 'x',
        coordinates: { group: 'g', name: 'n' },
        projectRoot: missingRoot,
        configuration: 'runtimeClasspath',
        forceRefresh: true,
        maxClasses: 5,
      },
    });
    expect(text(r)).toContain('does not exist');
  });

  test('unadvertised parameters are still type-checked', async () => {
    const r = await client.callTool({
      name: 'get_class_source',
      arguments: { className: 'a.B', projectRoot: missingRoot, forceRefresh: 'yes' },
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(text(r)).toContain('forceRefresh');
  });

  test('get_class_source accepts a bare string methodNames', async () => {
    const r = await client.callTool({
      name: 'get_class_source',
      arguments: { className: 'a.B', projectRoot: missingRoot, methodNames: 'foo' },
    });
    expect(text(r)).toContain('does not exist');
  });
});
