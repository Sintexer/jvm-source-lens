/**
 * Fixed phrases of the two genuinely ambiguous errors that name the exact retry call.
 * The eval scorer (`test/evals/scoring.ts`) imports them, so copy edits cannot move its metrics.
 */

/** `MODULE_AMBIGUOUS` when the class resolves to different artifacts in different modules. */
export const PER_MODULE_ARTIFACT_PHRASE = 'resolves to different artifacts per module';

/** `INVALID_FQN` when a simple name matches several classes. */
export const NOT_FULLY_QUALIFIED_PHRASE = 'is not fully qualified and matches';
