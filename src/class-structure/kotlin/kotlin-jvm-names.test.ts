import { describe, expect, test } from 'bun:test';
import { kotlinJvmMethods, kotlinTypeMatchesJvm, type KotlinJvmMethod } from './kotlin-jvm-names.js';
import { parseKotlinTypeMetadata } from './parse-kotlin-type-metadata.js';

function methods(src: string, className: string, statics = true): KotlinJvmMethod[] {
  return kotlinJvmMethods(parseKotlinTypeMetadata(src, className)!, statics);
}

function sig(m: KotlinJvmMethod): string {
  return `${m.jvmName}/${m.params.length}`;
}

describe('kotlinJvmMethods', () => {
  test('shouldAddReceiverAndContinuationSlotsForSuspendExtensions', () => {
    const src = 'package p\n\npublic suspend fun CoroutineScope.run(a: Int, b: String): Unit {}\n';
    const [m] = methods(src, 'p.FileKt');
    expect(m!.jvmName).toBe('run');
    expect(m!.params.map((p) => [p.name, p.synthetic])).toEqual([
      ['$receiver', true],
      ['a', false],
      ['b', false],
      ['$completion', true],
    ]);
  });

  test('shouldRenameWithJvmNameAndMarkInternalAsMangleable', () => {
    const src = 'package p\n\nclass A {\n  @JvmName("renamed") fun f(x: Int) {}\n  internal fun g(x: Int) {}\n  fun h(x: Int) {}\n}\n';
    const byName = Object.fromEntries(methods(src, 'p.A').map((m) => [m.jvmName, m]));
    expect(byName['renamed']).toBeDefined();
    expect(byName['f']).toBeUndefined();
    expect(byName['g']!.canBeMangled).toBe(true);
    expect(byName['h']!.canBeMangled).toBe(false);
  });

  test('shouldAllowManglingWhenAParameterTypeIsNotAKnownJvmType', () => {
    const src = 'package p\n\nfun a(d: Duration) {}\nfun b(n: Long) {}\n';
    const byName = Object.fromEntries(methods(src, 'p.FileKt').map((m) => [m.jvmName, m]));
    expect(byName['a']!.canBeMangled).toBe(true);
    expect(byName['b']!.canBeMangled).toBe(false);
  });

  test('shouldAddOneOverloadPerDroppedDefaultWhenJvmOverloads', () => {
    const src = 'package p\n\nclass A {\n  @JvmOverloads fun f(a: Int, b: Int = 1, c: Int = 2) {}\n  fun g(a: Int, b: Int = 1) {}\n}\n';
    const all = methods(src, 'p.A').map(sig);
    expect(all.filter((s) => s.startsWith('f/')).sort()).toEqual(['f/1', 'f/2', 'f/3']);
    expect(all.filter((s) => s.startsWith('g/'))).toEqual(['g/2']);
    const f2 = methods(src, 'p.A').find((m) => sig(m) === 'f/2')!;
    expect(f2.params.map((p) => p.name)).toEqual(['a', 'b']);
  });

  test('shouldMapPropertiesToGettersAndSetters', () => {
    const src = `package p

class A {
    val name: String = ""
    var count: Int = 0
    val isReady: Boolean = true
    var isOpen: Boolean = false
    @get:JvmName("fetch") val other: String = ""
    @JvmField val raw: Int = 1
    const val LIMIT = 1
    private val hidden = 1
}
`;
    expect(methods(src, 'p.A').map(sig).sort()).toEqual(
      ['<init>/0', 'fetch/0', 'getCount/0', 'getName/0', 'isOpen/0', 'isReady/0', 'setCount/1', 'setOpen/1'].sort(),
    );
  });

  test('shouldMapConstructorsWithPropertiesDataClassMembersAndDefaults', () => {
    const src = 'package p\n\ndata class P(val x: Int, var y: String = "a")\n';
    expect(methods(src, 'p.P').map(sig).sort()).toEqual(
      ['<init>/2', 'component1/0', 'component2/0', 'copy/2', 'getX/0', 'getY/0', 'setY/1'].sort(),
    );
  });

  test('shouldAddNoArgConstructorWhenEveryConstructorParameterHasADefault', () => {
    const src = 'package p\n\nclass A(val x: Int = 1)\n';
    expect(methods(src, 'p.A').filter((m) => m.role === 'constructor').map(sig).sort()).toEqual(['<init>/0', '<init>/1']);
  });

  test('shouldAddEnumConstructorSyntheticSlots', () => {
    const src = 'package p\n\nenum class E(val a: Int) { X(1) }\n';
    const ctor = methods(src, 'p.E').find((m) => m.role === 'constructor')!;
    expect(ctor.params.map((p) => p.synthetic)).toEqual([true, true, false]);
  });

  test('shouldMapCompanionStaticsOntoTheOuterClassOnlyWhenAsked', () => {
    const src = 'package p\n\nclass A {\n  companion object {\n    @JvmStatic fun make(x: Int) = 1\n    fun plain() = 2\n  }\n}\n';
    expect(methods(src, 'p.A', true).map(sig)).toContain('make/1');
    expect(methods(src, 'p.A', true).map(sig)).not.toContain('plain/0');
    expect(methods(src, 'p.A', false).map(sig)).not.toContain('make/1');
    expect(methods(src, 'p.A$Companion', false).map(sig).sort()).toEqual(['make/1', 'plain/0']);
  });
});

describe('kotlinTypeMatchesJvm', () => {
  test('shouldMatchBuiltinsAndNullableBoxing', () => {
    expect(kotlinTypeMatchesJvm('Long', 'long')).toBe('match');
    expect(kotlinTypeMatchesJvm('Long?', 'java.lang.Long')).toBe('match');
    expect(kotlinTypeMatchesJvm('Long?', 'long')).toBe('mismatch');
    expect(kotlinTypeMatchesJvm('String', 'java.lang.String')).toBe('match');
    expect(kotlinTypeMatchesJvm('Int', 'java.lang.String')).toBe('mismatch');
  });

  test('shouldMatchCollectionsFunctionTypesAndArraysIgnoringGenerics', () => {
    expect(kotlinTypeMatchesJvm('List<String>', 'java.util.List<? super')).toBe('match');
    expect(kotlinTypeMatchesJvm('MutableMap<A, B>', 'java.util.Map')).toBe('match');
    expect(kotlinTypeMatchesJvm('suspend CoroutineScope.() -> R', 'kotlin.jvm.functions.Function2<? super')).toBe('match');
    expect(kotlinTypeMatchesJvm('(Int) -> Unit', 'java.lang.String')).toBe('mismatch');
    expect(kotlinTypeMatchesJvm('IntArray', 'int[]')).toBe('match');
    expect(kotlinTypeMatchesJvm('Array<String>', 'java.lang.String[]')).toBe('match');
  });

  test('shouldComparePlainTypesBySimpleNameAndOtherwiseBeUnknown', () => {
    expect(kotlinTypeMatchesJvm('Foo', 'com.x.Foo')).toBe('match');
    expect(kotlinTypeMatchesJvm('Outer.Inner', 'com.x.Outer$Inner')).toBe('match');
    expect(kotlinTypeMatchesJvm('Duration', 'long')).toBe('unknown');
    expect(kotlinTypeMatchesJvm('T', 'java.lang.Object')).toBe('unknown');
    expect(kotlinTypeMatchesJvm('Foo', 'com.x.Bar')).toBe('unknown');
  });
});
