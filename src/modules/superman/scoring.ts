/**
 * Superman scoring mirrors the dead-bug scoring shape:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is keyed to shoulderRise peak instead of extension angle.
 * Smoothness and MQS/DCI math are reused verbatim from the squat module.
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak shoulderRise (normalised y-units). */
export function getCompletionScore(shoulderRisePeak: number): number {
  if (shoulderRisePeak >= 0.12) return 100;
  if (shoulderRisePeak >= 0.10) return 85;
  if (shoulderRisePeak >= 0.08) return 70;
  if (shoulderRisePeak >= 0.06) return 50;
  if (shoulderRisePeak >= 0.04) return 25;
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
