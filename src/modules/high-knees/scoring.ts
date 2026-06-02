/**
 * High Knees scoring — mirrors squat / calf-raise MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on peak knee lift (% of shoulder width).
 * - 60+ ≈ knee at hip level (target high-knee depth)
 * - 30-35 ≈ knee at mid-thigh (acceptable)
 * - < 30 fails the rep-validation gate upstream.
 *
 * Form is two-factor (torso-OK + completion-OK). No bilateral symmetry term —
 * reps are by-design alternating-unilateral.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak knee lift percent. */
export function getCompletionScore(peakKneeLiftPct: number): number {
  if (peakKneeLiftPct >= 60) return 100;
  if (peakKneeLiftPct >= 45) return 85;
  if (peakKneeLiftPct >= 35) return 70;
  if (peakKneeLiftPct >= 30) return 55;   // floor — anything below 30 fails MIN_REP_HEIGHT
  if (peakKneeLiftPct >= 15) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during the active phase. */
export function getFormScore(form: {
  torsoOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const torsoPct = form.torsoOKCount / form.totalCount;
  return Math.round(torsoPct * 100);
}
