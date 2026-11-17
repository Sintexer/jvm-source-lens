import { describe, expect, test } from 'bun:test';
import { parseJavaClassSkeleton } from './parse-java-class-skeleton.js';
import {
  JAVA_SOURCE_SYNTHETIC_DESC_PREFIX,
  collectMethodSourceSpans,
  isSyntheticJvmDescriptor,
  parseJavaTypeMetadata,
  syntheticJvmDescriptor,
} from './parse-java-type-metadata.js';

describe('parseJavaTypeMetadata', () => {
  test('class header same-package extends / implements', () => {
    const src = `
package com.example;

public class Foo extends Bar implements Baz, Quux {
}
`;
    const meta = parseJavaTypeMetadata(src, 'com.example.Foo');
    expect(meta).not.toBeNull();
    expect(meta!.header.kind).toBe('class');
    expect(meta!.header.superClass).toBe('com.example.Bar');
    expect(meta!.header.directInterfaces).toEqual(['com.example.Baz', 'com.example.Quux']);
  });

  test('bounded type parameter does not truncate/replace the real extends clause', () => {
    const src = `
package com.example;

public abstract class Handler<K, V extends Comparable<K>> extends AbstractHandler<V> implements SomeInterface {
}
`;
    const meta = parseJavaTypeMetadata(src, 'com.example.Handler');
    expect(meta).not.toBeNull();
    expect(meta!.header.superClass).toBe('com.example.AbstractHandler');
    expect(meta!.header.directInterfaces).toEqual(['com.example.SomeInterface']);
    expect(meta!.header.typeParameterNames).toEqual(['K', 'V']);
  });

  test('generic superclass argument is not mistaken for the class own type parameter', () => {
    const src = `
package com.example;

public abstract class OutboundOrderRestateHandler extends AbstractBiTemporalEventHandler<OutboundOrder> implements SomeInterface {
}
`;
    const meta = parseJavaTypeMetadata(src, 'com.example.OutboundOrderRestateHandler');
    expect(meta).not.toBeNull();
    expect(meta!.header.superClass).toBe('com.example.AbstractBiTemporalEventHandler');
    expect(meta!.header.typeParameterNames).toEqual([]);
  });

  test('interface extends with import resolution', () => {
    const src = `
package x;

import java.util.List;

public interface Face extends Iterable<String>, AutoCloseable {
  void run();
}
`;
    const meta = parseJavaTypeMetadata(src, 'x.Face');
    expect(meta).not.toBeNull();
    expect(meta!.header.kind).toBe('interface');
    expect(meta!.header.directInterfaces.some((x) => x.endsWith('Iterable'))).toBe(true);
    expect(meta!.header.directInterfaces.some((x) => x.endsWith('AutoCloseable'))).toBe(true);
    const run = meta!.methods.find((m) => m.jvmMethodName === 'run');
    expect(run).toBeDefined();
    expect(isSyntheticJvmDescriptor(run!.jvmDescriptor)).toBe(true);
  });

  test('methods constructors fields', () => {
    const src = `
package q;

public class Box {
  private static final int X = 1;
  private final String name;

  public Box(String name) {
    this.name = name;
  }

  public String getName() {
    return name;
  }

  public static Box empty() {
    return new Box("");
  }
}
`;
    const meta = parseJavaTypeMetadata(src, 'q.Box');
    expect(meta).not.toBeNull();
    const xField = meta!.fields.find((f) => f.declarationLine.includes('X'));
    expect(xField).toBeDefined();
    expect(xField!.declarationLine).toBe('int X = 1');
    expect(xField!.declarationLine).not.toMatch(/\b(public|private|static|final)\b/);
    expect(meta!.fields.some((f) => f.declarationLine.includes('name'))).toBe(true);
    const ctor = meta!.methods.find((m) => m.jvmMethodName === '<init>');
    expect(ctor).toBeDefined();
    expect(ctor!.parameters.length).toBe(1);
    const getName = meta!.methods.find((m) => m.jvmMethodName === 'getName');
    expect(getName).toBeDefined();
    const empty = meta!.methods.find((m) => m.jvmMethodName === 'empty');
    expect(empty?.declarationLine.includes('static')).toBe(true);
  });

  test('public static final constant declarationLine is type and name only', () => {
    const src = `
package deltix.cerebro.algorithm.base.constants;

public class TimeConstants {
  public static final long ZERO = 0L;
  public static final long SECOND = 1000L;
}
`;
    const meta = parseJavaTypeMetadata(src, 'deltix.cerebro.algorithm.base.constants.TimeConstants');
    expect(meta).not.toBeNull();
    const zero = meta!.fields.find((f) => /\bZERO\b/.test(f.declarationLine));
    expect(zero).toBeDefined();
    expect(zero!.declarationLine).toBe('long ZERO = 0L');
    expect(zero!.visibility).toBe('public');
  });

  test('enum constants', () => {
    const src = `
package e;

public enum Color { RED, GREEN, BLUE }
`;
    const meta = parseJavaTypeMetadata(src, 'e.Color');
    expect(meta).not.toBeNull();
    expect(meta!.header.kind).toBe('enum');
    expect(meta!.fields.some((f) => f.enumConstant && f.declarationLine.includes('RED'))).toBe(true);
  });

  test('syntheticJvmDescriptor prefix stable', () => {
    expect(syntheticJvmDescriptor('foo', ['int', 'String'])).toBe(
      `${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}foo(int,String)`,
    );
  });
});

describe('parseJavaTypeMetadata annotated members', () => {
  const src = `
package com.example;
import java.util.*;
public final class Lists {
  private Lists() {}
  @GwtCompatible(serializable = true)
  public static <E extends @Nullable Object> ArrayList<E> newArrayList() { return null; }
  @GwtCompatible
  public static <E> List<E> asList(E first, E[] rest) { return null; }
  @J2ktIncompatible @GwtIncompatible
  public static <E> List<E> newCopy() { return null; }
  @Deprecated public static void old() {}
  public static <E> @Nullable E annotatedReturn(@Nullable E first) { return null; }
  @Nullable
  public String viaDoc(
      @Nullable String first) { return null; }
}
`;
  const methods = () =>
    Object.fromEntries(
      parseJavaTypeMetadata(src, 'com.example.Lists')!.methods.map((m) => [m.jvmMethodName, m]),
    );

  test('annotations (with and without arguments) never become method names', () => {
    expect(Object.keys(methods()).sort()).toEqual(
      ['<init>', 'annotatedReturn', 'asList', 'newArrayList', 'newCopy', 'old', 'viaDoc'].sort(),
    );
  });

  test('return types do not carry annotations or modifiers', () => {
    const m = methods();
    expect(m.asList!.returnTypeDisplay).toBe('List<E>');
    expect(m.newCopy!.returnTypeDisplay).toBe('List<E>');
    expect(m.old!.returnTypeDisplay).toBe('void');
    expect(m.annotatedReturn!.returnTypeDisplay).toBe('E');
    expect(m.viaDoc!.returnTypeDisplay).toBe('String');
  });

  test('parameter counts survive annotations', () => {
    const m = methods();
    expect(m.newArrayList!.parameters).toHaveLength(0);
    expect(m.asList!.parameters).toHaveLength(2);
    expect(m.annotatedReturn!.parameters).toHaveLength(1);
  });
});

const NESTED_OUTER = `package com.google.common.collect;

/** outer list */
public class ImmutableList {
  void outerOnly() {}

  /**
   * Builds an immutable list.
   */
  public static final class Builder {
    /** Appends one element. */
    public Builder add(Object element) { return this; }

    public ImmutableList build(int expectedSize) { return null; }
  }

  void afterBuilder() {}
}
`;

describe('parseJavaTypeMetadata nested binary name', () => {
  test('reads javadoc and parameter names of the nested type', () => {
    const meta = parseJavaTypeMetadata(NESTED_OUTER, 'com.google.common.collect.ImmutableList$Builder');
    expect(meta).not.toBeNull();
    expect(meta!.header.kind).toBe('class');
    const add = meta!.methods.find((m) => m.jvmMethodName === 'add');
    const build = meta!.methods.find((m) => m.jvmMethodName === 'build');
    expect(add?.parameters.map((p) => p.name)).toEqual(['element']);
    expect(build?.parameters.map((p) => p.name)).toEqual(['expectedSize']);
    expect(meta!.methods.some((m) => m.jvmMethodName === 'outerOnly')).toBe(false);
    expect(meta!.methods.some((m) => m.jvmMethodName === 'afterBuilder')).toBe(false);

    const skeleton = parseJavaClassSkeleton(NESTED_OUTER, 'com.google.common.collect.ImmutableList$Builder');
    expect(skeleton.typeJavadoc).toContain('Builds an immutable list');
    expect(skeleton.typeJavadoc).not.toContain('outer list');
    expect(skeleton.methods.find((m) => m.name === 'add')?.javadoc).toContain('Appends one element');
  });

  test('method spans are offsets in the enclosing file', () => {
    const spans = collectMethodSourceSpans(NESTED_OUTER, 'com.google.common.collect.ImmutableList$Builder');
    expect(spans).not.toBeNull();
    const build = spans!.find((s) => s.jvmMethodName === 'build');
    expect(build).toBeDefined();
    const text = NESTED_OUTER.slice(build!.start, build!.end);
    expect(text).toContain('build(int expectedSize)');
    expect(text).not.toContain('outerOnly');
    expect(build!.start).toBeGreaterThan(NESTED_OUTER.indexOf('class Builder'));
  });

  test('same simple name under two outers stays on the requested path', () => {
    const src = `
package p;
public class OuterA {
  public static class Builder { void fromA(int a) {} }
}
class OuterB {
  public static class Builder { void fromB(String b) {} }
}
`;
    const a = parseJavaTypeMetadata(src, 'p.OuterA$Builder');
    const b = parseJavaTypeMetadata(src, 'p.OuterB$Builder');
    expect(a!.methods.map((m) => m.jvmMethodName)).toEqual(['fromA']);
    expect(a!.methods[0]!.parameters.map((p) => p.name)).toEqual(['a']);
    expect(b!.methods.map((m) => m.jvmMethodName)).toEqual(['fromB']);
    expect(b!.methods[0]!.parameters.map((p) => p.name)).toEqual(['b']);
  });

  test('exact nested file with no outer declaration parses the innermost type', () => {
    const src = `package com.example;
/** builder file */
public class Builder {
  public Builder add(Object element) { return this; }
}
`;
    const meta = parseJavaTypeMetadata(src, 'com.example.Outer$Builder');
    expect(meta).not.toBeNull();
    expect(meta!.methods.find((m) => m.jvmMethodName === 'add')?.parameters.map((p) => p.name)).toEqual(['element']);
    const skeleton = parseJavaClassSkeleton(src, 'com.example.Outer$Builder');
    expect(skeleton.typeJavadoc).toContain('builder file');
  });
});

describe('parseJavaTypeMetadata type resolution and field initializers', () => {
  const methodNames = (src: string, fqn: string): string[] =>
    parseJavaTypeMetadata(src, fqn)!.methods.map((m) => m.jvmMethodName);
  const fieldNames = (src: string, fqn: string): string[] =>
    parseJavaTypeMetadata(src, fqn)!.fields.map((f) => f.jvmDescriptor.slice(`${JAVA_SOURCE_SYNTHETIC_DESC_PREFIX}field:`.length));

  test('shouldResolveThrowsToStarImportAndJavaLangWhenNameIsNotImportedExplicitly', () => {
    const src = `package com.x;
import java.io.*;
public class Foo {
  public void run() throws IOException, Exception {}
}`;
    const run = parseJavaTypeMetadata(src, 'com.x.Foo')!.methods.find((m) => m.jvmMethodName === 'run');
    expect(run!.thrownExceptions).toEqual(['java.io.IOException', 'java.lang.Exception']);
  });

  test('shouldKeepSimpleNameWhenSeveralStarImportsCouldDeclareIt', () => {
    const src = `package com.x;
import java.io.*;
import java.nio.file.*;
public class Foo {
  public void run() throws WeirdException {}
}`;
    const run = parseJavaTypeMetadata(src, 'com.x.Foo')!.methods.find((m) => m.jvmMethodName === 'run');
    expect(run!.thrownExceptions).toEqual(['WeirdException']);
  });

  test('shouldResolveNestedTypeToBinaryNameWhenDeclaredInSameFile', () => {
    const src = `package com.x;
public class Foo {
  public static class MyEx extends Exception {}
  public void run() throws MyEx {}
}`;
    const run = parseJavaTypeMetadata(src, 'com.x.Foo')!.methods.find((m) => m.jvmMethodName === 'run');
    expect(run!.thrownExceptions).toEqual(['com.x.Foo$MyEx']);
  });

  test('shouldNotParseFieldInitializerAsMethodWhenInitializerCallsConstructor', () => {
    const src = `package com.x;
import java.util.concurrent.ConcurrentHashMap;
public class Foo {
  static final Object A = new Intro();
  final ConcurrentHashMap<String, java.util.List<Object>> m
      = new ConcurrentHashMap<String, java.util.List<Object>>(64, 0.6f, 2);
  public void run() {}
}`;
    expect(methodNames(src, 'com.x.Foo')).toEqual(['run']);
    expect(fieldNames(src, 'com.x.Foo')).toEqual(['A', 'm']);
  });

  test('shouldNameFieldByDeclaratorWhenInitializerIsLiteral', () => {
    const src = `package q;
public class Box {
  private static final int X = 1;
}`;
    expect(fieldNames(src, 'q.Box')).toEqual(['X']);
  });

  test('shouldSkipInitializerBodyWhenFieldHoldsLambdaAnonymousClassOrArray', () => {
    const src = `package q;
public class Box {
  Runnable r = () -> { run(); };
  Object o = new Object() { void hidden() {} };
  int[] a = {1, 2};
  boolean b = x < y;
  public void after() {}
}`;
    expect(methodNames(src, 'q.Box')).toEqual(['after']);
    expect(fieldNames(src, 'q.Box')).toEqual(['r', 'o', 'a', 'b']);
    const o = parseJavaTypeMetadata(src, 'q.Box')!.fields.find((f) => f.declarationLine.startsWith('Object'));
    expect(o!.declarationLine).toBe('Object o = …');
  });

  test('shouldParseMethodWhenAnnotationArgumentContainsAssignment', () => {
    const src = `package q;
public class Box {
  @Anno(v = 1) public void m() {}
  @Anno(v = 2) abstract void n();
}`;
    expect(methodNames(src, 'q.Box')).toEqual(['m', 'n']);
  });

  test('shouldIgnoreTypeNameInJavadocWhenParsingNestedType', () => {
    const src = `package p;
class Outer {
  /** Unlike class Inner here */
  void m() { int x = 1; }
  static class Inner { void inside() {} }
}`;
    expect(methodNames(src, 'p.Outer$Inner')).toEqual(['inside']);
  });

  test('shouldIgnoreTypeNameInFileHeaderJavadocWhenParsingTopLevelType', () => {
    const src = `package p;
/** The class Foo is documented here. */
public class Foo extends Bar { void inside() {} }`;
    const meta = parseJavaTypeMetadata(src, 'p.Foo')!;
    expect(meta.header.superClass).toBe('p.Bar');
    expect(meta.methods.map((m) => m.jvmMethodName)).toEqual(['inside']);
  });
});
