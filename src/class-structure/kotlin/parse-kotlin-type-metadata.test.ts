import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { parseKotlinTypeMetadata, type KotlinMember } from './parse-kotlin-type-metadata.js';

function fixture(name: string): string {
  return fs.readFileSync(new URL(`../../../test/fixtures/kotlin/${name}`, import.meta.url), 'utf8');
}

function named(members: KotlinMember[], name: string): KotlinMember[] {
  return members.filter((m) => m.name === name);
}

describe('parseKotlinTypeMetadata on ktor HttpMethod', () => {
  const src = fixture('HttpMethod.kt');

  test('shouldReadDataClassWithPrimaryConstructorPropertyAndKdocTag', () => {
    const meta = parseKotlinTypeMetadata(src, 'io.ktor.http.HttpMethod')!;
    expect(meta.kind).toBe('class');
    expect(meta.isData).toBe(true);
    expect(meta.typeKdoc).toContain('Represents an HTTP method (verb)');
    const ctor = meta.members.find((m) => m.kind === 'constructor')!;
    expect(ctor.parameters.map((p) => [p.name, p.type, p.property])).toEqual([['value', 'String', 'val']]);
    const value = named(meta.members, 'value')[0]!;
    expect(value.kind).toBe('property');
    expect(value.kdoc).toBe('contains method name');
    expect(named(meta.members, 'toString')[0]!.type).toBe('String');
  });

  test('shouldReadCompanionMembersWithKdocAndTypes', () => {
    const meta = parseKotlinTypeMetadata(src, 'io.ktor.http.HttpMethod')!;
    expect(meta.companion?.name).toBe('Companion');
    const parse = named(meta.companion!.members, 'parse')[0]!;
    expect(parse.kind).toBe('fun');
    expect(parse.parameters.map((p) => [p.name, p.type])).toEqual([['method', 'String']]);
    expect(parse.kdoc).toContain('Parse HTTP method by [method] string');
    expect(named(meta.companion!.members, 'DefaultMethods')[0]!.type).toBe('List<HttpMethod>');
    expect(named(meta.companion!.members, 'Get')[0]!.kind).toBe('property');
  });

  test('shouldReturnCompanionMembersWhenTheNestedCompanionIsRequested', () => {
    const meta = parseKotlinTypeMetadata(src, 'io.ktor.http.HttpMethod$Companion')!;
    expect(meta.members.map((m) => m.name)).toContain('parse');
    expect(meta.members.map((m) => m.name)).not.toContain('toString');
  });

  test('shouldCoverTheMemberTextIncludingKdoc', () => {
    const meta = parseKotlinTypeMetadata(src, 'io.ktor.http.HttpMethod')!;
    const parse = named(meta.companion!.members, 'parse')[0]!;
    const text = src.slice(parse.start, parse.end);
    expect(text.startsWith('/**')).toBe(true);
    expect(text.trimEnd().endsWith('}')).toBe(true);
    expect(text).toContain('else -> HttpMethod(method)');
  });
});

describe('parseKotlinTypeMetadata on kotlinx-coroutines Delay.kt', () => {
  const src = fixture('Delay.kt');

  test('shouldReadTopLevelFunctionsAsAFacade', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.DelayKt')!;
    expect(meta.kind).toBe('facade');
    const delays = named(meta.members, 'delay').filter((m) => m.kind === 'fun');
    expect(delays.map((d) => d.parameters.map((p) => `${p.name}: ${p.type}`))).toEqual([
      ['timeMillis: Long'],
      ['duration: Duration'],
    ]);
    expect(delays.every((d) => d.isSuspend && d.visibility === 'public')).toBe(true);
    expect(delays[1]!.type).toBe('Unit');
    expect(named(meta.members, 'awaitCancellation')[0]!.type).toBe('Nothing');
  });

  test('shouldReadExtensionPropertyWithGetterAndInternalVisibility', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.DelayKt')!;
    const prop = meta.members.find((m) => m.kind === 'property' && m.name === 'delay')!;
    expect(prop.receiver).toBe('CoroutineContext');
    expect(prop.type).toBe('Delay');
    expect(prop.visibility).toBe('internal');
    expect(prop.hasCustomGetter).toBe(true);
    expect(prop.kdoc).toBe('Returns [Delay] implementation of the given context');
  });

  test('shouldReadExtensionFunctionWithExpressionBody', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.DelayKt')!;
    const fn = named(meta.members, 'toDelayMillis')[0]!;
    expect(fn.receiver).toBe('Duration');
    expect(fn.type).toBe('Long');
    expect(src.slice(fn.start, fn.end).trimEnd().endsWith('}')).toBe(true);
    expect(src.slice(fn.start, fn.end)).toContain('false -> 0L');
  });

  test('shouldReadInterfaceMembersWithBodiesAnnotationsAndAbstractFuns', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.Delay')!;
    expect(meta.kind).toBe('interface');
    expect(meta.members.map((m) => m.name)).toEqual(['delay', 'scheduleResumeAfterDelay', 'invokeOnTimeout']);
    const abstractFun = named(meta.members, 'scheduleResumeAfterDelay')[0]!;
    expect(abstractFun.parameters.map((p) => p.type)).toEqual(['Long', 'CancellableContinuation<Unit>']);
    expect(src.slice(abstractFun.start, abstractFun.end).trimEnd().endsWith('Unit>)')).toBe(true);
    const withDefault = named(meta.members, 'invokeOnTimeout')[0]!;
    expect(src.slice(withDefault.start, withDefault.end)).toContain('DefaultDelay.invokeOnTimeout');
    expect(named(meta.members, 'delay')[0]!.kdoc).toBe('@suppress *');
  });

  test('shouldReturnNullWhenNeitherTypeNorFacadeMembersExist', () => {
    expect(parseKotlinTypeMetadata('package a\n\nimport b.C\n', 'a.Missing$Inner')).toBeNull();
  });
});

describe('parseKotlinTypeMetadata on kotlinx-coroutines CoroutineScope.kt', () => {
  const src = fixture('CoroutineScope.kt');

  test('shouldReadInterfaceProperty', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.CoroutineScope')!;
    expect(meta.kind).toBe('interface');
    const prop = named(meta.members, 'coroutineContext')[0]!;
    expect(prop.kind).toBe('property');
    expect(prop.type).toBe('CoroutineContext');
    expect(prop.mutable).toBe(false);
  });

  test('shouldReadObjectWithOverrideProperty', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.GlobalScope')!;
    expect(meta.kind).toBe('object');
    expect(named(meta.members, 'coroutineContext')[0]!.kind).toBe('property');
  });

  test('shouldReadOverloadedExtensionsWithDefaultsAndTypeParameters', () => {
    const meta = parseKotlinTypeMetadata(src, 'kotlinx.coroutines.CoroutineScopeKt')!;
    const cancels = named(meta.members, 'cancel');
    expect(cancels).toHaveLength(2);
    expect(cancels[0]!.receiver).toBe('CoroutineScope');
    expect(cancels[0]!.parameters.map((p) => [p.name, p.type, p.hasDefault])).toEqual([
      ['cause', 'CancellationException?', true],
    ]);
    expect(cancels[1]!.parameters.map((p) => p.name)).toEqual(['message', 'cause']);
    const scope = named(meta.members, 'coroutineScope')[0]!;
    expect(scope.isSuspend).toBe(true);
    expect(scope.parameters[0]!.type).toBe('suspend CoroutineScope.() -> R');
    expect(scope.type).toBe('R');
    const factory = named(meta.members, 'CoroutineScope')[0]!;
    expect(factory.kind).toBe('fun');
    const active = named(meta.members, 'isActive')[0]!;
    expect(active.receiver).toBe('CoroutineScope');
    expect(active.hasCustomGetter).toBe(true);
    expect(named(meta.members, 'currentCoroutineContext')[0]!.isSuspend).toBe(true);
  });
});

describe('parseKotlinTypeMetadata on ktor Url.kt and HttpStatusCode.kt', () => {
  test('shouldReadInternalPrimaryConstructorAndPropertyParameters', () => {
    const meta = parseKotlinTypeMetadata(fixture('Url.kt'), 'io.ktor.http.Url')!;
    expect(meta.kind).toBe('class');
    const ctor = meta.members.find((m) => m.kind === 'constructor')!;
    expect(ctor.visibility).toBe('internal');
    expect(ctor.parameters.map((p) => p.name)).toEqual([
      'protocol',
      'host',
      'specifiedPort',
      'pathSegments',
      'parameters',
      'fragment',
      'user',
      'password',
      'trailingQuery',
      'urlString',
    ]);
    const host = meta.members.find((m) => m.kind === 'property' && m.name === 'host')!;
    expect(host.visibility).toBe('public');
    expect(host.kdoc).toBe('name without port (domain)');
    expect(meta.members.find((m) => m.kind === 'property' && m.name === 'urlString')!.visibility).toBe('private');
  });

  test('shouldReadDataClassCompanionAndMultiLineDeclarations', () => {
    const meta = parseKotlinTypeMetadata(fixture('HttpStatusCode.kt'), 'io.ktor.http.HttpStatusCode')!;
    expect(meta.isData).toBe(true);
    expect(named(meta.members, 'compareTo')[0]!.type).toBe('Int');
    expect(named(meta.members, 'description').find((m) => m.kind === 'fun')!.kdoc).toContain('Returns a copy of');
    const names = meta.companion!.members.map((m) => m.name);
    expect(names).toContain('NonAuthoritativeInformation');
    expect(names).toContain('OK');
    expect(meta.companion!.members.every((m) => m.kind === 'property' || m.kind === 'fun')).toBe(true);
  });
});

describe('parseKotlinTypeMetadata on small snippets', () => {
  test('shouldReadJvmAnnotationsAndUseSiteTargets', () => {
    const src = `package p

class A {
    @JvmName("renamed")
    fun original(x: Int) = x

    @JvmStatic @JvmOverloads
    fun both(a: Int, b: Int = 1, c: Int = 2) {}

    @JvmField
    val raw: Int = 1

    @get:JvmName("fetch")
    val prop: String = ""

    const val LIMIT = 5
    lateinit var late: String
}
`;
    const meta = parseKotlinTypeMetadata(src, 'p.A')!;
    expect(named(meta.members, 'original')[0]!.jvmName).toBe('renamed');
    const both = named(meta.members, 'both')[0]!;
    expect(both.jvmStatic && both.jvmOverloads).toBe(true);
    expect(both.parameters.map((p) => p.hasDefault)).toEqual([false, true, true]);
    expect(named(meta.members, 'raw')[0]!.jvmField).toBe(true);
    expect(named(meta.members, 'prop')[0]!.getterJvmName).toBe('fetch');
    expect(named(meta.members, 'LIMIT')[0]!.isConst).toBe(true);
    expect(named(meta.members, 'late')[0]!.mutable).toBe(true);
  });

  test('shouldNotBeFooledByStringsTemplatesAndNestedComments', () => {
    const src = `package p

class A {
    val a = "}{ \${ "}" }"
    /* /* } */ { */
    fun f(s: String = "a,b)"): String = "x" // }
    fun g() {
        val raw = """
            }
        """
    }
    fun h() = 1
}
`;
    const meta = parseKotlinTypeMetadata(src, 'p.A')!;
    expect(meta.members.filter((m) => m.kind !== 'constructor').map((m) => m.name)).toEqual(['a', 'f', 'g', 'h']);
    expect(named(meta.members, 'f')[0]!.parameters[0]!.hasDefault).toBe(true);
  });

  test('shouldReadNestedTypesAndSkipEnumEntries', () => {
    const src = `package p

enum class Color(val rgb: Int) {
    RED(1), GREEN(2) { override fun tag() = "g" };

    open fun tag(): String = "x"
    fun rgbHex(): String = "#"
}

class Outer {
    class Inner {
        fun inside() {}
    }
    fun outside() {}
}
`;
    const color = parseKotlinTypeMetadata(src, 'p.Color')!;
    expect(color.kind).toBe('enum');
    expect(color.members.filter((m) => m.kind === 'fun').map((m) => m.name)).toEqual(['tag', 'rgbHex']);
    expect(parseKotlinTypeMetadata(src, 'p.Outer$Inner')!.members.map((m) => m.name)).toContain('inside');
    expect(parseKotlinTypeMetadata(src, 'p.Outer')!.members.map((m) => m.name)).not.toContain('inside');
  });

  test('shouldReadSecondaryConstructorsAndImplicitDefaultConstructor', () => {
    const src = `package p

class A(val x: Int) {
    constructor() : this(0)
    constructor(s: String, y: Int = 1) : this(s.length)
}

class B {
    fun f() {}
}
`;
    const a = parseKotlinTypeMetadata(src, 'p.A')!;
    expect(a.members.filter((m) => m.kind === 'constructor').map((m) => m.parameters.length)).toEqual([1, 0, 2]);
    const b = parseKotlinTypeMetadata(src, 'p.B')!;
    expect(b.members.filter((m) => m.kind === 'constructor').map((m) => m.parameters.length)).toEqual([0]);
  });

  test('shouldReadPropertyAccessorsOnFollowingLines', () => {
    const src = `package p

class A {
    var size: Int = 0
        private set
    val doubled: Int
        get() = size * 2
    var custom: Int
        get() { return 1 }
        set(value) { println(value) }
}
`;
    const meta = parseKotlinTypeMetadata(src, 'p.A')!;
    const size = named(meta.members, 'size')[0]!;
    expect(size.hasCustomSetter).toBe(true);
    expect(src.slice(size.start, size.end)).toContain('private set');
    expect(named(meta.members, 'doubled')[0]!.hasCustomGetter).toBe(true);
    const custom = named(meta.members, 'custom')[0]!;
    expect(custom.hasCustomGetter && custom.hasCustomSetter).toBe(true);
    expect(src.slice(custom.start, custom.end).trimEnd().endsWith('}')).toBe(true);
  });

  test('shouldKeepExpressionBodiesTogetherAcrossIfElseAndAnnotatedLines', () => {
    const src = `package p

internal fun <T> recover(state: Any?): Result<T> =
    if (state is String)
        Result.failure(Exception())
    else
        Result.success(state as T)

public inline fun <T> Grouping<T>.fold(op: (T) -> Int): Map<T, Int> =
    @Suppress("UNCHECKED_CAST")
    aggregate { key, acc -> op(key) }

private fun missing() =
    if (x) A() else
        cause?.let { throw it } ?: fail()

fun after() = 1
`;
    const meta = parseKotlinTypeMetadata(src, 'p.FileKt')!;
    expect(meta.members.map((m) => m.name)).toEqual(['recover', 'fold', 'missing', 'after']);
    const fold = named(meta.members, 'fold')[0]!;
    expect(src.slice(fold.start, fold.end)).toContain('aggregate { key, acc -> op(key) }');
    expect(src.slice(named(meta.members, 'missing')[0]!.start, named(meta.members, 'missing')[0]!.end)).toContain('fail()');
  });

  test('shouldReadParenthesizedReceiverAndAnnotatedAccessor', () => {
    const src = `package p

public fun <T> (suspend () -> T).asFlow(): Flow<T> = flow { emit(invoke()) }

public val <T : Any> KClass<T>.java: Class<T>
    @JvmName("getJavaClass")
    get() = (this as Foo).jClass as Class<T>

public val after = 1
`;
    const meta = parseKotlinTypeMetadata(src, 'p.FileKt')!;
    expect(meta.members.map((m) => m.name)).toEqual(['asFlow', 'java', 'after']);
    expect(named(meta.members, 'asFlow')[0]!.receiver).toBe('(suspend () -> T)');
    expect(named(meta.members, 'java')[0]!.hasCustomGetter).toBe(true);
  });

  test('shouldReadConstructorKeywordFollowedByParenthesesOnTheNextLine', () => {
    const src = `package p

public open class Progression
    internal constructor
    (
        start: Char,
        step: Int
    ) : Iterable<Char> {
    fun first() = 1
}
`;
    const meta = parseKotlinTypeMetadata(src, 'p.Progression')!;
    const ctor = meta.members.find((m) => m.kind === 'constructor')!;
    expect(ctor.visibility).toBe('internal');
    expect(ctor.parameters.map((p) => p.name)).toEqual(['start', 'step']);
    expect(meta.members.map((m) => m.name)).toContain('first');
  });
});
