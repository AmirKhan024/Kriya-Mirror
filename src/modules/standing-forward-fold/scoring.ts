/**
 * Standing Forward Fold scoring helpers.
 *
 * Hold-based scoring reuses plank's completion + final-MQS formula
 * (completion × 0.40 + form × 0.60). Here we only define the per-frame form
 * PENALTIES for the two recoverable form-breaks (not folded deep enough,
 * knees bending). The engine smooths the resulting raw form score.
 */

const FOLD_HOLD_MIN_DEG = 50;   // matches engine FOLD_HOLD_MIN_DEG
const KNEE_BENT_DEG = 35;       // matches engine KNEE_BENT_DEG

/** Penalty for not folding deep enough. Grows as the fold angle falls short of
 *  the hold threshold; capped at 40. Zero once at/above threshold. */
export function getNotDeepPenalty(foldAngleDeg: number): number {
  if (foldAngleDeg >= FOLD_HOLD_MIN_DEG) return 0;
  return Math.min(40, (FOLD_HOLD_MIN_DEG - foldAngleDeg) * 1.5);
}

/** Penalty for knees bending (the fold is a hip hinge — legs stay near-straight).
 *  Grows past the knee-bent threshold; capped at 40. */
export function getKneeBentPenalty(kneeFlexionDeg: number): number {
  if (kneeFlexionDeg <= KNEE_BENT_DEG) return 0;
  return Math.min(40, (kneeFlexionDeg - KNEE_BENT_DEG) * 1.5);
}
