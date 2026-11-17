import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { locateKotlinTypeDeclaration } from './locate-kotlin-declaration.js';

const src = `package p

/** Outer docs. */
@Deprecated("x")
public class Outer<T>(val a: Int = run { 1 }, val f: () -> Unit = { println("}") }) : Base(), Iface {
    /** Inner docs. */
    class Inner {
        fun inside() {}
    }

    companion object {
        fun make() = 1
    }

    object Named : Iface

    class Empty
}

class Secondary(val x: Int)

interface I {
    fun f()
}
`;

describe('locateKotlinTypeDeclaration', () => {
  test('shouldIncludeKdocAndAnnotationsAndSkipLambdaBracesInTheConstructor', () => {
    const span = locateKotlinTypeDeclaration(src, ['Outer'])!;
    expect(src.slice(span.start).startsWith('/** Outer docs. */')).toBe(true);
    expect(src[span.openBrace]).toBe('{');
    expect(src[span.closeBrace]).toBe('}');
    expect(src.slice(span.start, span.closeBrace + 1)).toContain('class Empty');
    expect(src.slice(span.start, span.closeBrace + 1)).not.toContain('class Secondary');
  });

  test('shouldLocateNestedTypesAndTheCompanion', () => {
    const inner = locateKotlinTypeDeclaration(src, ['Outer', 'Inner'])!;
    expect(src.slice(inner.start, inner.closeBrace + 1)).toBe('/** Inner docs. */\n    class Inner {\n        fun inside() {}\n    }');
    const companion = locateKotlinTypeDeclaration(src, ['Outer', 'Companion'])!;
    expect(src.slice(companion.start, companion.closeBrace + 1)).toContain('fun make()');
    expect(locateKotlinTypeDeclaration(src, ['Outer', 'Named'])).not.toBeNull();
  });

  test('shouldReturnBodylessTypesEndingAtTheirDeclaration', () => {
    const empty = locateKotlinTypeDeclaration(src, ['Outer', 'Empty'])!;
    expect(empty.openBrace).toBe(-1);
    expect(src.slice(empty.start, empty.closeBrace + 1)).toBe('class Empty');
    const secondary = locateKotlinTypeDeclaration(src, ['Secondary'])!;
    expect(src.slice(secondary.start, secondary.closeBrace + 1)).toBe('class Secondary(val x: Int)');
  });

  test('shouldReturnNullWhenANameIsMissingOrTheParentHasNoBody', () => {
    expect(locateKotlinTypeDeclaration(src, ['Missing'])).toBeNull();
    expect(locateKotlinTypeDeclaration(src, ['Outer', 'Missing'])).toBeNull();
    expect(locateKotlinTypeDeclaration(src, ['Secondary', 'Inner'])).toBeNull();
    expect(locateKotlinTypeDeclaration(src, [])).toBeNull();
  });

  test('shouldFindAClassAmongManyInARealMultiClassFile', () => {
    const real = fs.readFileSync(new URL('../../../test/fixtures/kotlin/CoroutineScope.kt', import.meta.url), 'utf8');
    const span = locateKotlinTypeDeclaration(real, ['GlobalScope'])!;
    const text = real.slice(span.start, span.closeBrace + 1);
    expect(text).toContain('public object GlobalScope : CoroutineScope');
    expect(text).not.toContain('fun CoroutineScope.cancel');
  });
});
