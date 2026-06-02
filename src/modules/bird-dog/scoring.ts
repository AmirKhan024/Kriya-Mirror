/**
 * Bird-Dog scoring mirrors the dead-bug scoring shape:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is keyed to smoothedExtension peak.
 * Smoothness and MQS/DCI math are reused verbatim from the squat module.
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak smoothedExtension angle.
 *  Bird-Dog uses MIN_COMPLETION_DEG = 45, FULL_COMPLETION_DEG = 70. */
export function getCompletionScore(smoothedExtensionPeakDeg: number): number {
  if (smoothedExtensionPeakDeg >= 70) return 100;
  if (smoothedExtensionPeakDeg >= 60) return 85;
  if (smoothedExtensionPeakDeg >= 50) return 75;
  if (smoothedExtensionPeakDeg >= 45) return 60;
  if (smoothedExtensionPeakDeg >= 35) return 40;
  if (smoothedExtensionPeakDeg >= 25) return 20;
  return 0;
}

/**
 * Form sub-score: proportion of active-rep frames where form was maintained.
 * For bird-dog, form tracks only whether the core stats were OK (totalCount).
 */
export function getFormScore(form: {
  hipOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  return Math.round(form.hipOKCount / form.totalCount * 100);
}
