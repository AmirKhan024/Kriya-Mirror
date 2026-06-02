/**
 * Seated March scoring — mirrors squat / high-knees MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on peak knee lift (% of shoulder width). Seated march
 * lifts are gentler than standing high knees, so the tiers are scaled down:
 * - 50+ ≈ knee well up toward the chest (target seated lift)
 * - 28-35 ≈ a modest lift (acceptable floor — below 28 fails rep-validation)
 *
 * Form is single-factor (torso-OK). No bilateral symmetry term — reps are
 * by-design alternating-unilateral.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak knee lift percent. */
export function getCompletionScore(peakKneeLiftPct: number): number {
  if (peakKneeLiftPct >= 50) return 100;
  if (peakKneeLiftPct >= 40) return 85;
  if (peakKneeLiftPct >= 33) return 70;
  if (peakKneeLiftPct >= 28) return 55;   // floor — anything below 28 fails MIN_REP_HEIGHT
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
