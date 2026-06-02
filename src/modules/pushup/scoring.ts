/**
 * Push-up scoring mirrors the squat scoring shape:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is keyed to elbow flexion bands (60° / 75° / 90°+ tiers) instead of
 * knee flexion. Smoothness and form math is reused verbatim from the squat module.
 */
export { getSmoothnessScore, computeMQS, calculateDCI } from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak elbow flexion. */
export function getCompletionScore(peakElbowFlexDeg: number): number {
  if (peakElbowFlexDeg >= 110) return 100;
  if (peakElbowFlexDeg >= 90) return 85;
  if (peakElbowFlexDeg >= 75) return 70;
  if (peakElbowFlexDeg >= 60) return 50;
  if (peakElbowFlexDeg >= 40) return 25;
  return 0;
}

/**
 * Form sub-score from per-frame adherence counts during the active push-up
 * phases (LOWERING / AT_BOTTOM / PUSHING). Each gate (hip alignment, elbow
 * track, body line) contributes equally.
 */
export function getFormScore(form: {
  hipOKCount: number;
  elbowOKCount: number;
  spineOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const hipPct = form.hipOKCount / form.totalCount;
  const elbowPct = form.elbowOKCount / form.totalCount;
  const spinePct = form.spineOKCount / form.totalCount;
  return Math.round((hipPct + elbowPct + spinePct) * (100 / 3));
}
