/**
 * Fire Hydrant scoring:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is keyed to thighLiftDeg peak.
 * Fire hydrant reaches ~60° at a good lift (vs donkey kick's ~80°).
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak thighLiftDeg angle.
 *  Fire Hydrant: MIN = 35°, FULL = 60°. */
export function getCompletionScore(thighLiftPeakDeg: number): number {
  if (thighLiftPeakDeg >= 60) return 100;
  if (thighLiftPeakDeg >= 50) return 85;
  if (thighLiftPeakDeg >= 45) return 75;
  if (thighLiftPeakDeg >= 35) return 60;
  if (thighLiftPeakDeg >= 25) return 40;
  if (thighLiftPeakDeg >= 15) return 20;
  return 0;
}

/**
 * Form sub-score: proportion of active-rep frames where form was maintained.
 */
export function getFormScore(form: {
  hipOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  return Math.round(form.hipOKCount / form.totalCount * 100);
}
