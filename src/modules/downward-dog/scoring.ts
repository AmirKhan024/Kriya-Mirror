/**
 * Downward Dog scoring helper.
 *
 * Hold-based scoring reuses plank's completion + final-MQS formula
 * (completion × 0.40 + form × 0.60). Here we only define the per-frame form
 * PENALTY for the single recoverable form-break — hips dropping (the inverted V
 * flattening). The engine smooths the resulting raw form score.
 */

const APEX_HOLD_MAX = 115; // matches engine APEX_HOLD_MAX

/** Penalty for the hips sagging (apex angle opening past the hold threshold
 *  toward a flat/plank line). Grows with the overshoot; capped at 40. */
export function getHipSagPenalty(apexAngleDeg: number): number {
  if (apexAngleDeg <= APEX_HOLD_MAX) return 0;
  return Math.min(40, (apexAngleDeg - APEX_HOLD_MAX) * 1.2);
}
