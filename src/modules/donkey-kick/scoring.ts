/**
 * Donkey Kick scoring mirrors the bird-dog scoring shape:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is keyed to thighLiftDeg peak.
 * Smoothness and MQS/DCI math are reused verbatim from the squat module.
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak thighLiftDeg angle.
 *  Donkey Kick uses MIN_COMPLETION_DEG = 45, FULL_COMPLETION_DEG = 75. */
export function getCompletionScore(thighLiftPeakDeg: number): number {
  if (thighLiftPeakDeg >= 75) return 100;
  if (thighLiftPeakDeg >= 65) return 85;
  if (thighLiftPeakDeg >= 55) return 75;
  if (thighLiftPeakDeg >= 45) return 60;
  if (thighLiftPeakDeg >= 35) return 40;
  if (thighLiftPeakDeg >= 25) return 20;
  return 0;
}

/**
 * Form sub-score: proportion of active-rep frames where form was maintained.
 * For donkey kick, form tracks only whether the core stats were OK (totalCount).
 */
export function getFormScore(form: {
  hipOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  return Math.round(form.hipOKCount / form.totalCount * 100);
}
