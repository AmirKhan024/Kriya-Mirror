/**
 * Standing Side Leg Raise scoring — mirrors high-knees / squat MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on peak abduction LIFT (degrees above the standing
 * baseline). Standing hip-abduction ROM is ~0–45°, so the tiers are set for
 * legs, NOT the arm-abduction ranges used by lateral-raise:
 *   - 40+ ≈ a full, controlled raise (leg well out to the side)
 *   - 25  ≈ the minimum that counts as a deliberate rep (MIN_REP_ABDUCTION_DEG)
 *   - < 22 fails the rep-validation gate upstream → low-leg-raise.
 *
 * Form is single-factor (torso-OK). No bilateral symmetry term — reps are
 * by-design alternating-unilateral.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak abduction lift (degrees). */
export function getCompletionScore(peakAbductionDeg: number): number {
  if (peakAbductionDeg >= 40) return 100;
  if (peakAbductionDeg >= 32) return 85;
  if (peakAbductionDeg >= 27) return 70;
  if (peakAbductionDeg >= 22) return 55;   // floor — below MIN_REP_ABDUCTION fails upstream
  if (peakAbductionDeg >= 12) return 25;
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
