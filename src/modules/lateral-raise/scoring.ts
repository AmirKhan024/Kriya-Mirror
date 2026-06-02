/**
 * Lateral Raise scoring — mirrors bicep-curl's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Only the completion tier differs: lateral raise ROM peaks at ~90°
 * (arms parallel to floor), so depth tiers cap at 90+ not 150+.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak average shoulder-abduction angle. */
export function getCompletionScore(peakAbductionDeg: number): number {
  if (peakAbductionDeg >= 88) return 100;   // parallel to floor or better
  if (peakAbductionDeg >= 80) return 85;
  if (peakAbductionDeg >= 75) return 70;    // floor — anything below 75° fails MIN_REP_PEAK
  if (peakAbductionDeg >= 60) return 40;
  return 0;
}

/** Form score from per-frame adherence counts during the active rep phases. */
export function getFormScore(form: {
  torsoOKCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const torsoPct = form.torsoOKCount / form.totalCount;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round((torsoPct + symPct) * (100 / 2));
}
