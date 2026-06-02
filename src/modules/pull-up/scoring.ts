/**
 * Pull-up scoring — mirrors bicep curl's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion tiers are mapped to pull-up elbow flex ROM:
 *   90° = minimum valid (chin near bar), 140°+ = deep full pull.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion score by peak average elbow flexion. */
export function getCompletionScore(peakElbowFlexDeg: number): number {
  if (peakElbowFlexDeg >= 140) return 100;
  if (peakElbowFlexDeg >= 120) return 85;
  if (peakElbowFlexDeg >= 105) return 70;
  if (peakElbowFlexDeg >= 90) return 55;
  if (peakElbowFlexDeg >= 60) return 25;
  return 0;
}

/** Form score from per-frame adherence during active rep phases. */
export function getFormScore(form: {
  noShrugCount: number;
  noKippingCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const noShrugPct = form.noShrugCount / form.totalCount;
  const noKipPct = form.noKippingCount / form.totalCount;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round((noShrugPct + noKipPct + symPct) * (100 / 3));
}
