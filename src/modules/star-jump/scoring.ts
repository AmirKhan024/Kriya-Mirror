/**
 * Star Jump scoring — same MQS formula as squat:
 *   MQS = smoothness × 0.35 + form × 0.40 + completion × 0.25
 *
 * Completion tiers are mapped to peak wristDelta (shoulder.y - wrist.y).
 * Positive delta = wrists above shoulders (overhead).
 */
export {
  getSmoothnessScore,
  computeMQS,
  calculateDCI,
} from '@/modules/squat/scoring';

/** Completion sub-score per rep, by peak wristDelta (normalised Y-units). */
export function getCompletionScore(peakWristDelta: number): number {
  if (peakWristDelta >= 0.18) return 100;
  if (peakWristDelta >= 0.14) return 85;
  if (peakWristDelta >= 0.10) return 70;
  if (peakWristDelta >= 0.06) return 55;  // floor — below MIN_REP_PEAK_DELTA fails
  if (peakWristDelta >= 0.03) return 25;
  return 0;
}

/** Form score from per-frame adherence counts during the active jump phases. */
export function getFormScore(form: {
  torsoOKCount: number;
  legSpreadOKCount: number;
  symmetryOKCount: number;
  totalCount: number;
}): number {
  if (form.totalCount === 0) return 50;
  const torsoPct = form.torsoOKCount / form.totalCount;
  const legPct = form.legSpreadOKCount / form.totalCount;
  const symPct = form.symmetryOKCount / form.totalCount;
  return Math.round((torsoPct + legPct + symPct) * (100 / 3));
}
