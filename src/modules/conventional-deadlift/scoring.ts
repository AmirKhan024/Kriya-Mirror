/**
 * Conventional Deadlift scoring.
 *
 * Completion keyed to peak hip-hinge angle (how deep the hinge reached).
 * A conventional deadlift at parallel hip height = ~70-80°.
 * Smoothness from hip-Y velocity coefficient of variation (same as squat/lunge).
 * Form from per-frame adherence counts.
 *
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 */

export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak hip hinge angle. */
export function getCompletionScore(peakHingeDeg: number): number {
  if (peakHingeDeg >= 80) return 100;
  if (peakHingeDeg >= 65) return 75;
  if (peakHingeDeg >= 50) return 50;
  if (peakHingeDeg >= 30) return 25;
  return 0;
}

/** Form sub-score from per-frame adherence counts (back straight, hips level). */
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
