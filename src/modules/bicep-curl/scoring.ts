/**
 * Bicep Curl scoring — mirrors squat's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Only the completion tier is remapped: anatomical curl ROM peaks at ~150°,
 * so depth tiers are higher than squat's knee-flex tiers.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak average elbow flexion. */
export function getCompletionScore(peakElbowFlexDeg: number): number {
  if (peakElbowFlexDeg >= 140) return 100;
  if (peakElbowFlexDeg >= 120) return 85;
  if (peakElbowFlexDeg >= 105) return 70;
  if (peakElbowFlexDeg >= 90) return 55;     // floor — anything below 90° fails MIN_REP_DEPTH
  if (peakElbowFlexDeg >= 60) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during the active curl phases. */
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
