import { describe, expect, test } from 'bun:test';
import { locateTypeDeclaration } from './locate-type-declaration.js';

function slice(source: string, names: string[]): string {
  const span = locateTypeDeclaration(source, names);
  expect(span).not.toBeNull();
  return source.slice(span!.start, span!.closeBrace + 1);
}

describe('locateTypeDeclaration', () => {
  test('a brace inside a string does not end the type', () => {
    const source = ['class Outer {', '  String s = "{";', '  void after() {}', '}'].join('\n');
    expect(slice(source, ['Outer'])).toContain('void after()');
  });

  test('a brace inside a char literal does not end the type', () => {
    const source = ['class Outer {', "  char c = '{';", '  void after() {}', '}'].join('\n');
    expect(slice(source, ['Outer'])).toContain('void after()');
  });

  test('a brace inside a comment does not end the type', () => {
    const source = ['class Outer {', '  void m() { /* { */ // {', '  }', '  void after() {}', '}'].join('\n');
    expect(slice(source, ['Outer'])).toContain('void after()');
  });

  test('a brace inside a text block does not end the type', () => {
    const source = ['class Outer {', '  String s = """', '    { not a brace', '    """;', '  void after() {}', '}'].join('\n');
    expect(slice(source, ['Outer'])).toContain('void after()');
  });

  test('start includes the javadoc and an annotation that contains braces', () => {
    const source = [
      'class Outer {',
      '  void before() {}',
      '  /** docs */',
      '  @Anno(value = { 1, 2 })',
      '  public static class Inner {',
      '    int x;',
      '  }',
      '}',
    ].join('\n');
    const text = slice(source, ['Outer', 'Inner']);
    expect(text.startsWith('/** docs */')).toBe(true);
    expect(text).toContain('@Anno(value = { 1, 2 })');
    expect(text).toContain('int x;');
    expect(text).not.toContain('void before()');
  });

  test('the body brace is after a generic clause', () => {
    const source = [
      'class Outer {',
      '  class Inner<T extends Map<String, List<Integer>>> {',
      '    T value;',
      '  }',
      '}',
    ].join('\n');
    const text = slice(source, ['Outer', 'Inner']);
    expect(text).toContain('T value;');
    expect(text.startsWith('class Inner<')).toBe(true);
  });

  test('nested record, enum, interface, and annotation type', () => {
    const source = [
      'class Outer {',
      '  record Rec(int x) { int y; }',
      '  enum E { A, B }',
      '  interface I { void m(); }',
      '  @interface Ann { int v(); }',
      '}',
    ].join('\n');
    expect(slice(source, ['Outer', 'Rec'])).toContain('int y;');
    expect(slice(source, ['Outer', 'E'])).toContain('A, B');
    expect(slice(source, ['Outer', 'I'])).toContain('void m();');
    expect(slice(source, ['Outer', 'Ann'])).toContain('int v();');
  });

  test('the same simple name under a different outer type is a different span', () => {
    const source = [
      'class A {',
      '  class Inner { int a; }',
      '}',
      'class B {',
      '  class Inner { int b; }',
      '}',
    ].join('\n');
    const a = slice(source, ['A', 'Inner']);
    const b = slice(source, ['B', 'Inner']);
    expect(a).toContain('int a;');
    expect(a).not.toContain('int b;');
    expect(b).toContain('int b;');
    expect(b).not.toContain('int a;');
  });

  test('a missing name returns null', () => {
    expect(locateTypeDeclaration('class Outer { }', ['Outer', 'Missing'])).toBeNull();
    expect(locateTypeDeclaration('class Outer { }', [])).toBeNull();
  });
});
