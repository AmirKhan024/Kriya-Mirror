/**
 * Arm Circles scoring — 2026-05-28 round 21: re-architected to mirror
 * lateral-raise scoring (peak-abduction completion, two-factor form).
 *
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep by peak abduction angle (degrees).
 *  140° is the MIN_REP_PEAK_DEG floor for arm circles (arms must reach near
 *  overhead). Beyond 160° = full overhead extension = top score. */
export function getCompletionScore(peakAbductionDeg: number): number {
  if (peakAbductionDeg >= 160) return 100;
  if (peakAbductionDeg >= 150) return 85;
  if (peakAbductionDeg >= 140) return 70;
  return 0;
}

/** Form score from per-frame adherence counts during the active phase
 *  (torso-OK + bilateral-symmetry). */
export function getFormScore(form: {
  torsoOKCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const torsoPct = form.torsoOKCount / form.totalCount;
  const symmetryPct = form.symmetryOKCount / form.totalCount;
  return Math.round((torsoPct + symmetryPct) * (100 / 2));
}
