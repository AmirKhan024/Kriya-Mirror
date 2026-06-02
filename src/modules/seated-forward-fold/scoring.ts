/**
 * Seated Forward Fold scoring helper.
 *
 * Hold-based scoring reuses plank's completion + final-MQS formula
 * (completion × 0.40 + form × 0.60). Here we only define the per-frame form
 * PENALTY for the single recoverable form-break — coming up out of the fold
 * (torso fold angle falling below the hold threshold). The engine smooths the
 * resulting raw form score.
 */

const FOLD_HOLD_MIN_DEG = 14; // matches engine FOLD_HOLD_MIN_DEG

/** Penalty for not folding deep enough. Grows as the fold angle falls short of
 *  the hold threshold; capped at 40. Zero once at/above threshold. */
export function getNotDeepPenalty(foldAngleDeg: number): number {
  if (foldAngleDeg >= FOLD_HOLD_MIN_DEG) return 0;
  return Math.min(40, (FOLD_HOLD_MIN_DEG - foldAngleDeg) * 1.5);
}
