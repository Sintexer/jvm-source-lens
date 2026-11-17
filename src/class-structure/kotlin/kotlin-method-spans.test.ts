import { describe, expect, test } from 'bun:test';
import { collectKotlinMethodSpans } from './kotlin-method-spans.js';

const src = `package p

class A(val x: Int) {
    fun go() {}

    @JvmName("renamed")
    fun original() = 1

    var count = 0

    companion object {
        @JvmStatic fun make() = A(1)
    }
}
`;

describe('collectKotlinMethodSpans', () => {
  const spans = collectKotlinMethodSpans(src, 'p.A')!;
  const textOf = (name: string): string[] =>
    spans.filter((s) => s.jvmMethodName === name).map((s) => src.slice(s.start, s.end).trim());

  test('shouldKeyFunctionsByJvmNameAndSourceName', () => {
    expect(textOf('go')).toEqual(['fun go() {}']);
    expect(textOf('renamed')).toEqual(['@JvmName("renamed")\n    fun original() = 1']);
    expect(textOf('original')).toEqual(['@JvmName("renamed")\n    fun original() = 1']);
  });

  test('shouldKeyPropertiesByGetterSetterAndName', () => {
    for (const name of ['getCount', 'setCount', 'count']) {
      expect(textOf(name)).toEqual(['var count = 0']);
    }
    expect(textOf('getX')).toEqual(['val x: Int']);
  });

  test('shouldIncludeTheConstructorAndCompanionMembers', () => {
    expect(textOf('<init>')).toEqual(['class A(val x: Int)']);
    expect(textOf('make')).toEqual(['@JvmStatic fun make() = A(1)']);
  });

  test('shouldReturnNullWhenTheTypeIsNotInTheSource', () => {
    expect(collectKotlinMethodSpans(src, 'p.Missing')).toBeNull();
  });
});
