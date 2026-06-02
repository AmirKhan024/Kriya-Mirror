/**
 * Hammer Curl scoring — same MQS formula as bicep curl:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion tiers mirror bicep curl — anatomical peak ROM for hammer curl
 * is comparable to supinated curl at ~130–140° from a front-camera perspective.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak average elbow flexion. */
export function getCompletionScore(peakElbowFlexDeg: number): number {
  if (peakElbowFlexDeg >= 130) return 100;
  if (peakElbowFlexDeg >= 110) return 85;
  if (peakElbowFlexDeg >= 95) return 70;
  if (peakElbowFlexDeg >= 85) return 55;   // floor — below 85° fails MIN_REP_DEPTH
  if (peakElbowFlexDeg >= 60) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during the active hammer curl phases. */
export function getFormScore(form: {
  torsoOKCount: number;
  elbowOKCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const torsoPct = form.torsoOKCount / form.totalCount;
  const elbowPct = form.elbowOKCount / form.totalCount;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round((torsoPct + elbowPct + symPct) * (100 / 3));
}
