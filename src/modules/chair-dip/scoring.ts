/**
 * Chair Dip scoring — mirrors bicep-curl MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion tiers are based on peak average bilateral elbow flexion during the dip.
 * A valid chair dip reaches ≥60° average elbow flex.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak average elbow flexion during the dip. */
export function getCompletionScore(peakElbowFlexDeg: number): number {
  if (peakElbowFlexDeg >= 90) return 100;
  if (peakElbowFlexDeg >= 75) return 85;
  if (peakElbowFlexDeg >= 60) return 70;
  if (peakElbowFlexDeg >= 45) return 40;
  return 0;
}

/** Form score from per-frame adherence counts during the active dip phases. */
export function getFormScore(form: {
  elbowFlareOKCount: number;
  torsoOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const flarePct = form.elbowFlareOKCount / form.totalCount;
  const torsoPct = form.torsoOKCount / form.totalCount;
  return Math.round((flarePct + torsoPct) * 50);
}
