/**
 * Inchworm scoring — re-exports shared utilities from squat, adds inchworm-specific
 * completion score keyed to peak hip-hinge angle.
 *
 * MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak hip hinge angle. */
export function getCompletionScore(peakHingeDeg: number): number {
  if (peakHingeDeg >= 75) return 100;
  if (peakHingeDeg >= 65) return 85;
  if (peakHingeDeg >= 55) return 70;
  if (peakHingeDeg >= 45) return 50;
  if (peakHingeDeg >= 30) return 25;
  return 0;
}

/**
 * Form sub-score for inchworm.
 * Inchworm MVP has no per-frame posture gates (no hip-sag, no spine-angle check),
 * so form is always 100.
 */
export function getFormScore(form: { totalCount: number }): number {
  void form;
  return 100;
}
