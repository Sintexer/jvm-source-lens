import { describe, expect, test } from 'bun:test';
import {
  JAVA_SOURCE_SYNTHETIC_DESC_PREFIX,
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
    expect(meta!.fields.some((f) => f.declarationLine.includes('name'))).toBe(true);
    const ctor = meta!.methods.find((m) => m.jvmMethodName === '<init>');
    expect(ctor).toBeDefined();
    expect(ctor!.parameters.length).toBe(1);
    const getName = meta!.methods.find((m) => m.jvmMethodName === 'getName');
    expect(getName).toBeDefined();
    const empty = meta!.methods.find((m) => m.jvmMethodName === 'empty');
    expect(empty?.declarationLine.includes('static')).toBe(true);
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
