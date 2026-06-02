/**
 * Dead Bug scoring mirrors the push-up scoring shape:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is keyed to smoothedExtension peak instead of elbow flexion.
 * Smoothness and MQS/DCI math are reused verbatim from the squat module.
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak smoothedExtension angle. */
export function getCompletionScore(smoothedExtensionPeakDeg: number): number {
  if (smoothedExtensionPeakDeg >= 65) return 100;
  if (smoothedExtensionPeakDeg >= 55) return 85;
  if (smoothedExtensionPeakDeg >= 45) return 70;
  if (smoothedExtensionPeakDeg >= 35) return 50;
  if (smoothedExtensionPeakDeg >= 25) return 25;
  return 0;
}

/**
 * Form sub-score from per-frame hip alignment adherence.
 * Only tracks hip alignment (hipOKCount / totalCount).
 */
export function getFormScore(form: {
  hipOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  return Math.round(form.hipOKCount / form.totalCount * 100);
}
