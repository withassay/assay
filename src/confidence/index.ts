import type { MaturityTier } from "../schema/types.js";

export interface ConfidenceResult {
  score: number;
  maturity: MaturityTier;
  case_count: number;
  variance: number;
}

/**
 * Compute confidence from per-case pass rates.
 *
 * Score is the mean of all pass rates. Variance is the statistical variance
 * across pass rates (measures consistency — low variance = reliable agent).
 *
 * STUB: maturity is always "unestablished" until issue #7 implements tier logic.
 *
 * @param casePassRates - Array of pass rates per case (0.0–1.0). E.g. a case
 *   that passed 2/3 repeats has a rate of ~0.667.
 */
export function computeConfidence(casePassRates: number[]): ConfidenceResult {
  const caseCount = casePassRates.length;

  if (caseCount === 0) {
    return { score: 0, maturity: "unestablished", case_count: 0, variance: 0 };
  }

  const sum = casePassRates.reduce((acc, r) => acc + r, 0);
  const score = sum / caseCount;

  // Population variance: mean of squared deviations from the mean
  const squaredDiffs = casePassRates.reduce((acc, r) => acc + (r - score) ** 2, 0);
  const variance = squaredDiffs / caseCount;

  return {
    score,
    maturity: "unestablished",
    case_count: caseCount,
    variance,
  };
}
