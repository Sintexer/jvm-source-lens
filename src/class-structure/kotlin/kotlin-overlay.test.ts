import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { buildKotlinOverlay } from './kotlin-overlay.js';

function fixture(name: string): string {
  return fs.readFileSync(new URL(`../../../test/fixtures/kotlin/${name}`, import.meta.url), 'utf8');
}

const CONT = 'kotlin.coroutines.Continuation<? super kotlin.Unit>';

describe('buildKotlinOverlay on kotlinx-coroutines Delay.kt', () => {
  const overlay = buildKotlinOverlay(fixture('Delay.kt'), 'kotlinx.coroutines.DelayKt')!;

  test('shouldPairOverloadsByTypeAndMangledName', () => {
    const plain = overlay.matchMethod('delay', ['long', CONT])!;
    expect(plain.params.map((p) => [p.name, p.synthetic])).toEqual([
      ['timeMillis', false],
      ['$completion', true],
    ]);
    expect(plain.kdoc).toContain('If the given [timeMillis] is non-positive');

    const mangled = overlay.matchMethod('delay-VtjQ1oo', ['long', CONT])!;
    expect(mangled.params[0]!.name).toBe('duration');
    expect(mangled.kdoc).toContain('If the given [duration] is non-positive');
  });

  test('shouldMapExtensionPropertyGetterAndInternalMangledFunction', () => {
    const getter = overlay.matchMethod('getDelay', ['kotlin.coroutines.CoroutineContext'])!;
    expect(getter.kdoc).toBe('Returns [Delay] implementation of the given context');
    expect(getter.params).toEqual([{ name: '$receiver', synthetic: true }]);
    const internal = overlay.matchMethod('toDelayMillis-LRDsOJo', ['long'])!;
    expect(internal.params[0]!.synthetic).toBe(true);
    expect(internal.kdoc).toContain('Convert this duration to its millisecond value');
  });

  test('shouldNotMatchSyntheticOrUnknownMethods', () => {
    expect(overlay.matchMethod('delay$default', ['long', CONT, 'int', 'java.lang.Object'])).toBeNull();
    expect(overlay.matchMethod('currentCoroutineContext$$forInline', [CONT])).toBeNull();
    expect(overlay.matchMethod('nothingLikeThis', [])).toBeNull();
    expect(overlay.matchMethod('delay', ['long'])).toBeNull();
  });
});

describe('buildKotlinOverlay on ktor HttpMethod.kt', () => {
  const src = fixture('HttpMethod.kt');

  test('shouldGiveKdocToPropertyGettersAndTheConstructorParameterNames', () => {
    const overlay = buildKotlinOverlay(src, 'io.ktor.http.HttpMethod')!;
    expect(overlay.typeKdoc).toContain('Represents an HTTP method (verb)');
    expect(overlay.matchMethod('getValue', [])!.kdoc).toBe('contains method name');
    const ctor = overlay.matchMethod('<init>', ['java.lang.String'])!;
    expect(ctor.params[0]!.name).toBe('value');
    expect(ctor.kdoc).toBeNull();
    expect(overlay.matchMethod('component1', [])).not.toBeNull();
    expect(overlay.matchMethod('copy', ['java.lang.String'])!.params[0]!.name).toBe('value');
    expect(overlay.matchMethod('toString', [])).not.toBeNull();
  });

  test('shouldMatchCompanionMembersOnTheCompanionClass', () => {
    const overlay = buildKotlinOverlay(src, 'io.ktor.http.HttpMethod$Companion')!;
    const parse = overlay.matchMethod('parse', ['java.lang.String'])!;
    expect(parse.params[0]!.name).toBe('method');
    expect(parse.kdoc).toContain('Parse HTTP method by [method] string');
    expect(overlay.matchMethod('getDefaultMethods', [])!.kdoc).toBe('A list of default HTTP methods\n\n[Report a problem](https://ktor.io/feedback/?fqname=io.ktor.http.HttpMethod.Companion.DefaultMethods)');
  });

  test('shouldGiveFieldKdocByName', () => {
    const overlay = buildKotlinOverlay(src, 'io.ktor.http.HttpMethod')!;
    expect(overlay.fieldKdoc('value')).toBe('contains method name');
    expect(overlay.fieldKdoc('missing')).toBeNull();
  });
});

describe('buildKotlinOverlay ties', () => {
  test('shouldLeaveAMemberUnmatchedWhenTwoSourceMembersFitEqually', () => {
    const src = 'package p\n\nclass A {\n  fun f(a: Foo) {}\n  fun f(a: Bar) {}\n}\n';
    const overlay = buildKotlinOverlay(src, 'p.A')!;
    expect(overlay.matchMethod('f', ['com.x.Other'])).toBeNull();
  });

  test('shouldPickTheOverloadWhoseTypeMatches', () => {
    const src = 'package p\n\nclass A {\n  fun f(alpha: Foo) {}\n  fun f(beta: Bar) {}\n}\n';
    const overlay = buildKotlinOverlay(src, 'p.A')!;
    expect(overlay.matchMethod('f', ['com.x.Foo'])!.params[0]!.name).toBe('alpha');
    expect(overlay.matchMethod('f', ['com.x.Bar'])!.params[0]!.name).toBe('beta');
  });

  test('shouldRejectACandidateWithAKnownTypeMismatch', () => {
    const src = 'package p\n\nclass A {\n  fun f(n: Int) {}\n  fun f(s: String) {}\n}\n';
    const overlay = buildKotlinOverlay(src, 'p.A')!;
    expect(overlay.matchMethod('f', ['int'])!.params[0]!.name).toBe('n');
    expect(overlay.matchMethod('f', ['java.lang.String'])!.params[0]!.name).toBe('s');
  });

  test('shouldReturnNullForAClassThatIsNotInTheSource', () => {
    expect(buildKotlinOverlay('package p\n\nclass A\n', 'p.Missing$X')).toBeNull();
  });
});
