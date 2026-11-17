import { describe, expect, test } from 'bun:test';
import { overlayMethodParameters } from './apply-kotlin-overlay.js';
import { buildKotlinOverlay } from './kotlin-overlay.js';

const src = `package p

class A {
    /** Greets. */
    fun greet(name: String, times: Int) {}
}

/** Top. */
suspend fun CoroutineScope.run(job: Job) {}
`;

describe('overlayMethodParameters', () => {
  test('shouldNameParametersAndReturnKdoc', () => {
    const overlay = buildKotlinOverlay(src, 'p.A')!;
    const params: Array<{ name: string | null; typeDisplay: string }> = [
      { name: null, typeDisplay: 'java.lang.String' },
      { name: null, typeDisplay: 'int' },
    ];
    const r = overlayMethodParameters(overlay, 'greet', params, (p) => p.typeDisplay)!;
    expect(r.params.map((p) => p.name)).toEqual(['name', 'times']);
    expect(r.params.map((p) => p.typeDisplay)).toEqual(['java.lang.String', 'int']);
    expect(r.kdoc).toBe('Greets.');
  });

  test('shouldKeepAJavapNameForSyntheticSlotsAndFallBackToThePlaceholder', () => {
    const overlay = buildKotlinOverlay(src, 'p.FileKt')!;
    const types = ['p.CoroutineScope', 'p.Job', 'kotlin.coroutines.Continuation<? super kotlin.Unit>'];
    const withJavapNames = overlayMethodParameters(
      overlay,
      'run',
      [
        { name: '$this$run', typeDisplay: types[0]! },
        { name: null, typeDisplay: types[1]! },
        { name: '$completion', typeDisplay: types[2]! },
      ],
      (p) => p.typeDisplay,
    )!;
    expect(withJavapNames.params.map((p) => p.name)).toEqual(['$this$run', 'job', '$completion']);
    const withoutNames = overlayMethodParameters(
      overlay,
      'run',
      types.map((typeDisplay) => ({ name: null as string | null, typeDisplay })),
      (p) => p.typeDisplay,
    )!;
    expect(withoutNames.params.map((p) => p.name)).toEqual(['$receiver', 'job', '$completion']);
  });

  test('shouldReturnNullWhenNoSourceMemberFits', () => {
    const overlay = buildKotlinOverlay(src, 'p.A')!;
    expect(overlayMethodParameters(overlay, 'missing', [], () => '')).toBeNull();
  });
});
