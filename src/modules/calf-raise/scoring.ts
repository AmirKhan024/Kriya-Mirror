/**
 * 2026-05-28 round 22: calf-raise scoring re-architected for HOLD-based
 * exercise. Mirrors BB6 heel-rise-hold weighting:
 *   MQS = steadiness × 0.30 + form × 0.30 + completion × 0.40
 *
 * Completion is tiered on % of target hold duration successfully held; each
 * heel-drop applies a flat 3-point penalty. Form is the per-frame ratio of
 * "elevation maintained at or above the dynamic drop threshold". Steadiness
 * is shared with squat/bicep-curl (1 − normalized CoM-X variance).
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score, tiered on % of target hold duration achieved.
 *  Mirrors BB6's banded scoring (90/75/50/25 thresholds → 100/75/50/25). */
export function getCompletionScore(
  secondsElapsed: number,
  targetDurationSec: number,
  heelDropCount: number,
): number {
  if (targetDurationSec <= 0) return 0;
  const pct = (secondsElapsed / targetDurationSec) * 100;
  let raw: number;
  if (pct >= 90) raw = 100;
  else if (pct >= 75) raw = 75;
  else if (pct >= 50) raw = 50;
  else if (pct >= 25) raw = 25;
  else raw = 0;
  return Math.max(0, raw - heelDropCount * 3);
}

/** Form score from per-frame elevation-OK counts during the active hold phase
 *  (`HOLDING` or `DROPPED` — counts both states so a single drop doesn't
 *  collapse form score to 0). */
export function getFormScore(form: {
  elevationOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  return Math.round((form.elevationOKCount / form.totalCount) * 100);
}
