/**
 * Jumping Jacks scoring — mirrors squat / calf-raise MQS formula:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion is tiered on peak composite openness (% of shoulder width). A
 * full jack lands around 75-90 % composite (arms fully overhead = ~80-100 %,
 * feet shoulder-width apart = ~100 %, average ~85-95). Anything under the
 * MIN_REP_OPENNESS_PCT floor (50 %) fails the rep-validation gate upstream,
 * so the lowest tier here doubles as the floor for borderline-accepted reps.
 *
 * Form score is two-factor (torso-OK + symmetry-OK) — no elbow-drift analog.
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak composite openness percent. */
export function getCompletionScore(peakCompositePct: number): number {
  if (peakCompositePct >= 85) return 100;
  if (peakCompositePct >= 70) return 85;
  if (peakCompositePct >= 60) return 70;
  if (peakCompositePct >= 50) return 55;   // floor — anything below 50 fails MIN_REP_OPENNESS
  if (peakCompositePct >= 30) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during the OPEN phase. */
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
