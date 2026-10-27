/**
 * Critic while-loop iteration decision rule.
 *
 * Extracted verbatim from the core runner (behavior-preserving refactor).
 * The runner's inline tree was:
 *   if (criticResult.passed)            → 'pass'   (exit loop, break)
 *   if (attempts < maxAttempts)         → 'revise' (auto-revision pass)
 *   else                                → 'give-up' (exhausted, break)
 *
 * `attempts++` / `autoRevisionsRun++` accounting stays in the runner at the
 * 'revise' branch; this leaf only decides which branch runs.
 */
import type { CriticResult } from './critic.js';

export type CriticIterationDecision = 'pass' | 'revise' | 'give-up';

/**
 * Decide the next critic-loop action for a completed evaluation.
 *
 * @param result      the critic result for this iteration
 * @param attempts    how many revision passes have already run
 * @param maxAttempts the revision budget (cap)
 */
export function decideCriticIteration(
  result: CriticResult,
  attempts: number,
  maxAttempts: number
): CriticIterationDecision {
  if (result.passed) {
    return 'pass';
  }
  if (attempts < maxAttempts) {
    return 'revise';
  }
  return 'give-up';
}