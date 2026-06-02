/**
 * Reverse Fly scoring — mirrors lateral-raise's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion tier is based on the bilateral average peak armLiftDeg.
 * A perfect rep has armLiftDeg ≈ 90° (arms horizontal).
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/**
 * Completion sub-score based on peak bilateral armLiftDeg (degrees).
 * 90° = arms fully horizontal (perfect rep).
 * 60° = AT_TOP_THRESHOLD (minimum to complete state).
 * 50° = MIN_REP_DEPTH_DEG (minimum for a valid rep).
 */
export function getCompletionScore(peakLiftDeg: number): number {
  if (peakLiftDeg >= 85) return 100;
  if (peakLiftDeg >= 75) return 90;
  if (peakLiftDeg >= 65) return 75;
  if (peakLiftDeg >= 55) return 55;
  if (peakLiftDeg >= 50) return 35;
  return 10;
}

/**
 * Form score from per-frame adherence counts during the active rep phases.
 */
export function getFormScore(form: {
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round(symPct * 100);
}
