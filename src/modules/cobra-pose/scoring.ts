/**
 * Cobra Pose scoring helper.
 *
 * Hold-based scoring reuses plank's completion + final-MQS formula
 * (completion × 0.40 + form × 0.60). Here we only define the per-frame form
 * PENALTY for the single recoverable form-break — the chest dropping (torso
 * elevation falling below the hold threshold). The engine smooths the result.
 */

const ELEV_HOLD_MIN = 14; // matches engine ELEV_HOLD_MIN

/** Penalty for not lifting the chest high enough (elevation below the hold
 *  threshold). Grows as the chest drops toward the floor; capped at 40. */
export function getChestNotLiftedPenalty(elevationDeg: number): number {
  if (elevationDeg >= ELEV_HOLD_MIN) return 0;
  return Math.min(40, (ELEV_HOLD_MIN - elevationDeg) * 3);
}
