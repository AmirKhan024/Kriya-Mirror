/**
 * Barbell Row scoring.
 *
 * Completion keyed to peak elbow flexion angle (how high the bar was pulled).
 * Smoothness from wrist-Y velocity coefficient of variation.
 * Form from per-frame adherence counts.
 *
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 */

export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/**
 * Completion sub-score per rep, by peak elbow flexion angle at row top.
 * At 120°+ = full contraction, at 80° = minimum acceptable.
 */
export function getCompletionScore(maxElbowFlexionDeg: number): number {
  if (maxElbowFlexionDeg >= 120) return 100;
  if (maxElbowFlexionDeg >= 100) return 75;
  if (maxElbowFlexionDeg >= 80) return 50;
  if (maxElbowFlexionDeg >= 60) return 25;
  return 0;
}

/** Form sub-score from per-frame adherence counts (back straight, no hip sway). */
export function getFormScore(form: {
  backStraightCount: number;
  hipLevelCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const backPct = form.backStraightCount / form.totalCount;
  const hipPct = form.hipLevelCount / form.totalCount;
  return Math.round((backPct + hipPct) * 50);
}
