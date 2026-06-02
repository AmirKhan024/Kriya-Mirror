/**
 * Front Raise scoring — mirrors lateral-raise's MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on peak shoulder-flexion angle (degrees).
 * - 90+ ≈ arm at or above horizontal (target)
 * - 80 ≈ acceptable boundary (floor — anything below fails MIN_REP_DEPTH)
 *
 * Form is two-factor (torso-OK + symmetry-OK). The L vs R symmetry term
 * matters even more in side view because the far-side arm has lower
 * MediaPipe visibility — divergent peaks indicate either a real asymmetry
 * or noisy occluded landmarks.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak average shoulder-flexion angle. */
export function getCompletionScore(peakFlexionDeg: number): number {
  if (peakFlexionDeg >= 95) return 100;
  if (peakFlexionDeg >= 88) return 85;
  if (peakFlexionDeg >= 82) return 70;
  if (peakFlexionDeg >= 80) return 55;   // floor — anything below 80 fails MIN_REP_DEPTH
  if (peakFlexionDeg >= 50) return 25;
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
